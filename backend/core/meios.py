"""Meios: viaturas, ferramentas/instrumentos e equipamento pesado (lógica do SHERT, simplificada).

    /api/tipos-meios/                             catálogo de tipos (Grua, Camião basculante…) — escrita: Administrador
    /api/meios/                                   CRUD do parque
    /api/meios/disponibilidade/?desde=…&ate=…&hora_inicio=…&hora_fim=…&tipo=…&tipo_meio=…&capacidade_min=…&excluir=…
                                                  cada meio com "disponivel" e os motivos quando não está
    /api/meios/<id>/calendario/?desde=…&ate=…     afectações do meio no período
    /api/alocacoes/?tarefa=…|evento=…|meio=…      afectações (Técnico cria/altera, só Administrador elimina…
                                                  excepto as que o próprio criou)
    /api/pedidos-meios/                           pedidos externos (só a referência da PO)
        <id>/chegou/   {codigo, nome, matricula}  o meio entra no parque como "alugado" e fica afectado
        <id>/devolvido/                           o meio sai do parque; as afectações futuras terminam
        <id>/anular/
    /api/ocupacao/?desde=…&ate=…&hora_inicio=…    onde está cada pessoa (tarefas e eventos) no período

Regras de coerência:
- a afectação pertence a uma tarefa OU a um evento, dentro do período deles;
- a pessoa que usa o meio tem de estar na equipa da tarefa / nos participantes do evento;
- o meio tem de estar activo e operacional (ou de utilização limitada);
- um meio não pode ter duas afectações que se sobreponham (dias inteiros, ou horas no mesmo dia).
"""
from datetime import date, time, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .agenda import ocorrencias
from .models import Alocacao, Evento, Meio, PedidoMeio, Pessoa, Tarefa, TipoMeio
from .permissions import CatalogoPermission, TarefaPermission, TemPerfil, perfil
from .serializers import nome_utilizador

MAX_DIAS = 92


def _data(v):
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        return None


def _hora(v):
    try:
        return time.fromisoformat(v) if v else None
    except ValueError:
        return None


def _dec(v):
    try:
        return Decimal(str(v).replace(",", ".")) if v not in (None, "") else None
    except InvalidOperation:
        return None


def capacidade_txt(valor, unidade):
    if valor is None:
        return ""
    n = f"{valor.normalize():f}".replace(".", ",")
    return f"{n} {unidade}".strip()


def _min(h, omissao):
    return h.hour * 60 + h.minute if h else omissao


def sobrepoe(a_ini, a_fim, a_hi, a_hf, b_ini, b_fim, b_hi, b_hf):
    """Dois períodos (datas + horas opcionais) sobrepõem-se? Sem horas = dias inteiros."""
    if a_ini > b_fim or b_ini > a_fim:
        return False
    if a_hi and b_hi and a_ini == a_fim == b_ini == b_fim:
        a0, a1 = _min(a_hi, 0), _min(a_hf, _min(a_hi, 0) + 60)
        b0, b1 = _min(b_hi, 0), _min(b_hf, _min(b_hi, 0) + 60)
        return a0 < b1 and b0 < a1
    return True


def _periodo_txt(ini, fim, hi=None, hf=None):
    p = f"{ini:%d/%m}" if ini == fim else f"{ini:%d/%m} a {fim:%d/%m}"
    if hi:
        p += f" {hi:%H:%M}" + (f"–{hf:%H:%M}" if hf else "")
    return p


def _onde(a):
    if a.tarefa_id:
        return f"Tarefa: {a.tarefa.localizacao} — {a.tarefa.descricao}"
    return f"{a.evento.get_tipo_display()}: {a.evento.titulo}"


def motivos_indisponivel(meio, ini, fim, hi=None, hf=None, excluir=None, alocacoes=None):
    """Lista de motivos (vazia = disponível). `alocacoes` permite passar as afectações já carregadas."""
    motivos = []
    if not meio.activo:
        motivos.append({"tipo": "inactivo", "texto": "Fora do parque (inactivo)"})
    elif meio.estado not in Meio.USAVEIS:
        motivos.append({"tipo": "estado", "texto": meio.get_estado_display()})
    lst = alocacoes if alocacoes is not None else (
        meio.alocacoes.filter(data_inicio__lte=fim, data_fim__gte=ini)
        .select_related("tarefa", "evento", "pessoa"))
    for a in lst:
        if excluir and a.pk == excluir:
            continue
        if sobrepoe(ini, fim, hi, hf, a.data_inicio, a.data_fim, a.hora_inicio, a.hora_fim):
            motivos.append({
                "tipo": "alocado", "alocacao": a.pk,
                "texto": f"{_onde(a)} · {_periodo_txt(a.data_inicio, a.data_fim, a.hora_inicio, a.hora_fim)}"
                         + (f" · {a.pessoa.nome}" if a.pessoa else ""),
            })
    return motivos


# ---------------------------------------------------------------- catálogo de tipos

class TipoMeioSerializer(serializers.ModelSerializer):
    categoria_nome = serializers.CharField(source="get_categoria_display", read_only=True)
    meios = serializers.IntegerField(source="meios.count", read_only=True)

    class Meta:
        model = TipoMeio
        fields = ["id", "nome", "categoria", "categoria_nome", "unidade", "descricao", "activo", "ordem", "meios"]

    def validate_nome(self, v):
        v = v.strip()
        qs = TipoMeio.objects.filter(nome__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Já existe um tipo com este nome.")
        return v

    def validate(self, d):
        inst = self.instance
        if inst and "categoria" in d and d["categoria"] != inst.categoria and inst.meios.exists():
            raise serializers.ValidationError({"categoria": "Há meios deste tipo: não se pode mudar a categoria."})
        return d


class TipoMeioViewSet(viewsets.ModelViewSet):
    serializer_class = TipoMeioSerializer
    permission_classes = [CatalogoPermission]   # leitura: todos · escrita: Administrador

    def get_queryset(self):
        qs = TipoMeio.objects.all()
        if self.request.query_params.get("activos") == "1":
            qs = qs.filter(activo=True)
        if self.request.query_params.get("categoria"):
            qs = qs.filter(categoria=self.request.query_params["categoria"])
        return qs

    def destroy(self, request, *args, **kwargs):
        t = self.get_object()
        if t.meios.exists() or t.pedidos.exists():
            return Response({"detail": "Há meios ou pedidos deste tipo. Desactive-o em vez de o eliminar."}, status=409)
        return super().destroy(request, *args, **kwargs)


# ---------------------------------------------------------------- meios

class MeioSerializer(serializers.ModelSerializer):
    tipo_nome = serializers.CharField(source="get_tipo_display", read_only=True)
    propriedade_nome = serializers.CharField(source="get_propriedade_display", read_only=True)
    estado_nome = serializers.CharField(source="get_estado_display", read_only=True)
    responsavel_nome = serializers.CharField(source="responsavel.nome", read_only=True, default=None)
    actualizado_por_nome = serializers.SerializerMethodField()
    hoje = serializers.SerializerMethodField()
    tipo_meio_nome = serializers.CharField(source="tipo_meio.nome", read_only=True, default=None)
    unidade = serializers.CharField(source="tipo_meio.unidade", read_only=True, default="")
    capacidade_texto = serializers.SerializerMethodField()

    class Meta:
        model = Meio
        fields = ["id", "codigo", "nome", "tipo", "tipo_nome", "tipo_meio", "tipo_meio_nome", "capacidade", "unidade",
                  "capacidade_texto", "propriedade", "propriedade_nome", "marca", "modelo",
                  "matricula", "numero_serie", "responsavel", "responsavel_nome", "estado", "estado_nome", "activo",
                  "fornecedor", "po_referencia", "notas", "actualizado_em", "actualizado_por_nome", "hoje"]
        read_only_fields = ["actualizado_em"]
        extra_kwargs = {"tipo": {"required": False}}

    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def get_hoje(self, obj):
        """Afectação de hoje (se houver), para a lista do parque."""
        hoje = timezone.localdate()
        cache = self.context.get("hoje")
        lst = cache.get(obj.pk, []) if cache is not None else list(
            obj.alocacoes.filter(data_inicio__lte=hoje, data_fim__gte=hoje).select_related("tarefa", "evento", "pessoa"))
        return [{"id": a.pk, "texto": _onde(a), "pessoa": a.pessoa.nome if a.pessoa else None,
                 "periodo": _periodo_txt(a.data_inicio, a.data_fim, a.hora_inicio, a.hora_fim)} for a in lst]

    def get_capacidade_texto(self, obj):
        return capacidade_txt(obj.capacidade, obj.tipo_meio.unidade if obj.tipo_meio else "")

    def validate(self, d):
        inst = self.instance
        tm = d["tipo_meio"] if "tipo_meio" in d else (inst.tipo_meio if inst else None)
        if tm:
            d["tipo"] = tm.categoria          # a categoria vem sempre do tipo
            if not tm.unidade:
                d["capacidade"] = None
        elif not d.get("tipo", inst.tipo if inst else None):
            raise serializers.ValidationError({"tipo_meio": "Escolha o tipo."})
        cap = d.get("capacidade")
        if cap is not None and cap <= 0:
            raise serializers.ValidationError({"capacidade": "A capacidade tem de ser maior que zero."})
        return d

    def validate_codigo(self, v):
        v = v.strip().upper()
        qs = Meio.objects.filter(codigo__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Já existe um meio com este código.")
        return v


class MeioViewSet(viewsets.ModelViewSet):
    serializer_class = MeioSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        qs = Meio.objects.select_related("responsavel", "tipo_meio", "actualizado_por__pessoa")
        p = self.request.query_params
        if p.get("tipo"):
            qs = qs.filter(tipo=p["tipo"])
        if p.get("tipo_meio"):
            qs = qs.filter(tipo_meio_id=p["tipo_meio"])
        if p.get("activo") in ("0", "1"):
            qs = qs.filter(activo=p["activo"] == "1")
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(codigo__icontains=q) | Q(nome__icontains=q) | Q(matricula__icontains=q)
                           | Q(po_referencia__icontains=q))
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.action == "list":
            hoje = timezone.localdate()
            cache = {}
            for a in (Alocacao.objects.filter(data_inicio__lte=hoje, data_fim__gte=hoje)
                      .select_related("tarefa", "evento", "pessoa")):
                cache.setdefault(a.meio_id, []).append(a)
            ctx["hoje"] = cache
        return ctx

    def perform_create(self, serializer):
        serializer.save(actualizado_por=self.request.user)

    def perform_update(self, serializer):
        serializer.save(actualizado_por=self.request.user)

    def destroy(self, request, *args, **kwargs):
        meio = self.get_object()
        if meio.alocacoes.exists() or meio.pedidos.exists():
            return Response({"detail": "Este meio tem histórico (afectações ou pedidos). Desactive-o em vez de o eliminar."},
                            status=409)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def disponibilidade(self, request):
        p = request.query_params
        ini = _data(p.get("desde")) or timezone.localdate()
        fim = _data(p.get("ate")) or ini
        if fim < ini:
            return Response({"ate": ["A data final é anterior à inicial."]}, status=400)
        hi, hf = (_hora(p.get("hora_inicio")), _hora(p.get("hora_fim"))) if ini == fim else (None, None)
        excluir = int(p["excluir"]) if p.get("excluir", "").isdigit() else None
        meios = Meio.objects.filter(activo=True).select_related("responsavel", "tipo_meio")
        if p.get("tipo"):
            meios = meios.filter(tipo=p["tipo"])
        if p.get("tipo_meio"):
            meios = meios.filter(tipo_meio_id=p["tipo_meio"])
        cap_min = _dec(p.get("capacidade_min"))
        alocs = {}
        for a in (Alocacao.objects.filter(data_inicio__lte=fim, data_fim__gte=ini)
                  .select_related("tarefa", "evento", "pessoa")):
            alocs.setdefault(a.meio_id, []).append(a)
        res = []
        for m in meios:
            motivos = motivos_indisponivel(m, ini, fim, hi, hf, excluir, alocs.get(m.pk, []))
            un = m.tipo_meio.unidade if m.tipo_meio else ""
            if cap_min is not None and un:
                if m.capacidade is None:
                    motivos.insert(0, {"tipo": "capacidade", "texto": "Capacidade não registada"})
                elif m.capacidade < cap_min:
                    motivos.insert(0, {"tipo": "capacidade", "texto": f"Capacidade {capacidade_txt(m.capacidade, un)} "
                                                                       f"< {capacidade_txt(cap_min, un)}"})
            res.append({"id": m.pk, "codigo": m.codigo, "nome": m.nome, "tipo": m.tipo,
                        "tipo_nome": m.get_tipo_display(), "tipo_meio": m.tipo_meio_id,
                        "tipo_meio_nome": m.tipo_meio.nome if m.tipo_meio else None,
                        "capacidade_texto": capacidade_txt(m.capacidade, un), "propriedade": m.propriedade,
                        "matricula": m.matricula, "disponivel": not motivos, "motivos": motivos})
        res.sort(key=lambda x: (not x["disponivel"], x["tipo"], x["nome"]))
        return Response({"desde": ini, "ate": fim, "meios": res})

    @action(detail=True, methods=["get"])
    def calendario(self, request, pk=None):
        meio = self.get_object()
        hoje = timezone.localdate()
        ini = _data(request.query_params.get("desde")) or hoje - timedelta(days=7)
        fim = min(_data(request.query_params.get("ate")) or ini + timedelta(days=41), ini + timedelta(days=MAX_DIAS))
        alocs = (meio.alocacoes.filter(data_inicio__lte=fim, data_fim__gte=ini)
                 .select_related("tarefa", "evento", "pessoa", "criado_por__pessoa"))
        return Response({"desde": ini, "ate": fim, "alocacoes": AlocacaoSerializer(alocs, many=True).data})


# ---------------------------------------------------------------- afectações

class AlocacaoSerializer(serializers.ModelSerializer):
    meio_nome = serializers.SerializerMethodField()
    meio_tipo = serializers.CharField(source="meio.tipo", read_only=True)
    pessoa_nome = serializers.CharField(source="pessoa.nome", read_only=True, default=None)
    onde = serializers.SerializerMethodField()
    periodo = serializers.SerializerMethodField()
    criado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = Alocacao
        fields = ["id", "meio", "meio_nome", "meio_tipo", "tarefa", "evento", "pessoa", "pessoa_nome",
                  "data_inicio", "data_fim", "hora_inicio", "hora_fim", "notas", "onde", "periodo",
                  "criado_por_nome", "criado_em"]
        read_only_fields = ["criado_em"]
        extra_kwargs = {"data_inicio": {"required": False}, "data_fim": {"required": False}}

    def get_meio_nome(self, obj):
        return str(obj.meio)

    def get_onde(self, obj):
        return _onde(obj)

    def get_periodo(self, obj):
        return _periodo_txt(obj.data_inicio, obj.data_fim, obj.hora_inicio, obj.hora_fim)

    def get_criado_por_nome(self, obj):
        return nome_utilizador(obj.criado_por)

    def validate(self, d):
        inst = self.instance
        v = lambda k: d[k] if k in d else (getattr(inst, k) if inst else None)  # noqa: E731
        tarefa, evento, meio, pessoa = v("tarefa"), v("evento"), v("meio"), v("pessoa")
        if bool(tarefa) == bool(evento):
            raise serializers.ValidationError("Indique a tarefa ou o evento (um dos dois).")

        # período: por omissão o da tarefa / evento
        if tarefa:
            if not tarefa.inicio:
                raise serializers.ValidationError({"tarefa": "A tarefa não tem datas: defina-as no planeamento primeiro."})
            t_ini, t_fim = tarefa.inicio, tarefa.fim or tarefa.inicio
            ini, fim = v("data_inicio") or t_ini, v("data_fim") or v("data_inicio") or t_fim
            if ini < t_ini or fim > t_fim:
                raise serializers.ValidationError(
                    {"data_inicio": f"Fora do período da tarefa ({_periodo_txt(t_ini, t_fim)})."})
            equipa = set(tarefa.equipa.values_list("id", flat=True))
        else:
            ini = v("data_inicio") or evento.data
            if evento.repeticao:
                fim = ini
                if ini not in set(ocorrencias(evento, ini, ini)):
                    raise serializers.ValidationError(
                        {"data_inicio": "Evento que se repete: escolha uma das datas em que ele acontece."})
            else:
                e_fim = evento.data_fim or evento.data
                fim = v("data_fim") or e_fim
                if ini < evento.data or fim > e_fim:
                    raise serializers.ValidationError(
                        {"data_inicio": f"Fora do período do evento ({_periodo_txt(evento.data, e_fim)})."})
            equipa = set(evento.participantes.values_list("id", flat=True))
            if "hora_inicio" not in d and not inst and ini == fim:
                d["hora_inicio"], d["hora_fim"] = evento.hora_inicio, evento.hora_fim
        if fim < ini:
            raise serializers.ValidationError({"data_fim": "A data de fim é anterior à de início."})
        d["data_inicio"], d["data_fim"] = ini, fim

        hi, hf = d.get("hora_inicio", v("hora_inicio")), d.get("hora_fim", v("hora_fim"))
        if ini != fim and (hi or hf):
            raise serializers.ValidationError({"hora_inicio": "Horas só para um único dia; para vários dias use dias inteiros."})
        if hf and not hi:
            raise serializers.ValidationError({"hora_inicio": "Indique a hora de início."})
        if hi and hf and hf <= hi:
            raise serializers.ValidationError({"hora_fim": "A hora de fim tem de ser depois da hora de início."})

        if pessoa and pessoa.id not in equipa:
            onde = "equipa da tarefa" if tarefa else "lista de participantes do evento"
            raise serializers.ValidationError({"pessoa": f"{pessoa.nome} não está na {onde}. Acrescente-a primeiro."})

        motivos = motivos_indisponivel(meio, ini, fim, hi, hf, excluir=inst.pk if inst else None)
        if motivos:
            raise serializers.ValidationError({"meio": [f"{meio.codigo} não está disponível: " + "; ".join(m["texto"] for m in motivos)]})
        return d


class AlocacaoPermission(TarefaPermission):
    """Técnico e Administrador afectam; eliminar: Administrador, ou o Técnico que criou a afectação."""

    def has_object_permission(self, request, view, obj):
        if request.method == "DELETE" and perfil(request.user) == "tecnico":
            return obj.criado_por_id == request.user.id
        return True

    def has_permission(self, request, view):
        if request.method == "DELETE" and perfil(request.user) == "tecnico":
            return True
        return super().has_permission(request, view)


class AlocacaoViewSet(viewsets.ModelViewSet):
    serializer_class = AlocacaoSerializer
    permission_classes = [AlocacaoPermission]

    def get_queryset(self):
        qs = Alocacao.objects.select_related("meio", "tarefa", "evento", "pessoa", "criado_por__pessoa")
        p = self.request.query_params
        for campo in ("tarefa", "evento", "meio", "pessoa"):
            if p.get(campo):
                qs = qs.filter(**{f"{campo}_id": p[campo]})
        if _data(p.get("desde")):
            qs = qs.filter(data_fim__gte=_data(p["desde"]))
        if _data(p.get("ate")):
            qs = qs.filter(data_inicio__lte=_data(p["ate"]))
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            # bloqueia o meio para que dois pedidos simultâneos não o afectem duas vezes
            Meio.objects.select_for_update().filter(pk=serializer.validated_data["meio"].pk).first()
            serializer.save(criado_por=self.request.user)


# ---------------------------------------------------------------- pedidos externos

class PedidoMeioSerializer(serializers.ModelSerializer):
    tipo_nome = serializers.CharField(source="get_tipo_display", read_only=True)
    estado_nome = serializers.CharField(source="get_estado_display", read_only=True)
    onde = serializers.SerializerMethodField()
    pessoa_nome = serializers.CharField(source="pessoa.nome", read_only=True, default=None)
    meio_nome = serializers.SerializerMethodField()
    solicitado_por_nome = serializers.SerializerMethodField()
    actualizado_por_nome = serializers.SerializerMethodField()
    tipo_meio_nome = serializers.CharField(source="tipo_meio.nome", read_only=True, default=None)
    unidade = serializers.CharField(source="tipo_meio.unidade", read_only=True, default="")
    capacidade_texto = serializers.SerializerMethodField()

    class Meta:
        model = PedidoMeio
        fields = ["id", "tipo", "tipo_nome", "tipo_meio", "tipo_meio_nome", "capacidade_minima", "unidade",
                  "capacidade_texto", "descricao", "data_inicio", "data_fim", "tarefa", "evento", "onde",
                  "pessoa", "pessoa_nome", "estado", "estado_nome", "po_referencia", "fornecedor", "meio", "meio_nome",
                  "chegou_em", "devolvido_em", "notas", "criado_em", "solicitado_por_nome", "actualizado_por_nome"]
        read_only_fields = ["estado", "meio", "chegou_em", "devolvido_em", "criado_em"]
        extra_kwargs = {"tipo": {"required": False}}

    def get_onde(self, obj):
        if obj.tarefa_id:
            return f"Tarefa: {obj.tarefa.localizacao} — {obj.tarefa.descricao}"
        if obj.evento_id:
            return f"{obj.evento.get_tipo_display()}: {obj.evento.titulo}"
        return None

    def get_meio_nome(self, obj):
        return str(obj.meio) if obj.meio else None

    def get_capacidade_texto(self, obj):
        if obj.capacidade_minima is None or not obj.tipo_meio:
            return ""
        return f"≥ {capacidade_txt(obj.capacidade_minima, obj.tipo_meio.unidade)}"

    def get_solicitado_por_nome(self, obj):
        return nome_utilizador(obj.solicitado_por)

    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def validate(self, d):
        inst = self.instance
        v = lambda k: d[k] if k in d else (getattr(inst, k) if inst else None)  # noqa: E731
        if v("tarefa") and v("evento"):
            raise serializers.ValidationError("Indique a tarefa ou o evento, não os dois.")
        if v("data_fim") and v("data_inicio") and v("data_fim") < v("data_inicio"):
            raise serializers.ValidationError({"data_fim": "A data de fim é anterior à de início."})
        if "po_referencia" in d:
            d["po_referencia"] = d["po_referencia"].strip().upper()
        tm = v("tipo_meio")
        if tm:
            d["tipo"] = tm.categoria
            if not tm.unidade:
                d["capacidade_minima"] = None
        elif not v("tipo"):
            raise serializers.ValidationError({"tipo": "Indique a categoria ou o tipo."})
        if inst and inst.estado in ("devolvido", "anulado"):
            raise serializers.ValidationError("Pedido fechado: já não pode ser alterado.")
        return d


class PedidoMeioViewSet(viewsets.ModelViewSet):
    serializer_class = PedidoMeioSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        qs = PedidoMeio.objects.select_related("tarefa", "evento", "pessoa", "meio", "tipo_meio", "solicitado_por__pessoa",
                                               "actualizado_por__pessoa")
        p = self.request.query_params
        if p.get("abertos") == "1":
            qs = qs.exclude(estado__in=["devolvido", "anulado"])
        for campo in ("estado", "tarefa", "evento", "tipo"):
            if p.get(campo):
                qs = qs.filter(**{campo: p[campo]})
        return qs

    def perform_create(self, serializer):
        po = serializer.validated_data.get("po_referencia")
        serializer.save(solicitado_por=self.request.user, actualizado_por=self.request.user,
                        estado="encomendado" if po else "pedido")

    def perform_update(self, serializer):
        inst = serializer.instance
        po = serializer.validated_data.get("po_referencia", inst.po_referencia)
        extra = {"actualizado_por": self.request.user}
        if inst.estado in ("pedido", "encomendado"):
            extra["estado"] = "encomendado" if po else "pedido"
        serializer.save(**extra)

    def _resposta(self, pedido):
        return Response(PedidoMeioSerializer(pedido).data)

    @action(detail=True, methods=["post"])
    def chegou(self, request, pk=None):
        """O meio chegou: entra no parque como alugado e, se o pedido é de uma tarefa/evento, fica afectado."""
        pedido = self.get_object()
        if pedido.estado != "encomendado":
            return Response({"detail": "Só um pedido com a referência da PO pode ser dado como chegado."}, status=409)
        dados = request.data
        codigo = (dados.get("codigo") or f"ALUG-{pedido.po_referencia}").strip().upper()[:40]
        if Meio.objects.filter(codigo__iexact=codigo).exists():
            return Response({"codigo": ["Já existe um meio com este código."]}, status=400)
        hoje = timezone.localdate()
        data = _data(dados.get("data")) or hoje
        with transaction.atomic():
            meio = Meio.objects.create(
                codigo=codigo, nome=(dados.get("nome") or pedido.descricao).strip()[:120], tipo=pedido.tipo,
                tipo_meio=pedido.tipo_meio,
                capacidade=(_dec(dados.get("capacidade")) or pedido.capacidade_minima)
                if pedido.tipo_meio and pedido.tipo_meio.unidade else None,
                propriedade=Meio.Propriedade.ALUGADO, matricula=(dados.get("matricula") or "").strip()[:30],
                fornecedor=pedido.fornecedor, po_referencia=pedido.po_referencia,
                notas=f"Pedido #{pedido.pk}", actualizado_por=request.user)
            pedido.meio, pedido.estado, pedido.chegou_em, pedido.actualizado_por = meio, "chegou", data, request.user
            pedido.save()
            aviso = None
            if pedido.tarefa_id or pedido.evento_id:
                ini = max(pedido.data_inicio, data)
                ser = AlocacaoSerializer(data={
                    "meio": meio.pk, "tarefa": pedido.tarefa_id, "evento": pedido.evento_id,
                    "pessoa": pedido.pessoa_id, "data_inicio": ini.isoformat(),
                    "data_fim": max(ini, pedido.data_fim).isoformat(), "notas": f"PO {pedido.po_referencia}"})
                if ser.is_valid():
                    ser.save(criado_por=request.user)
                else:
                    aviso = "O meio entrou no parque mas não foi afectado automaticamente: " + str(ser.errors)
        r = self._resposta(pedido)
        if aviso:
            r.data["aviso"] = aviso
        return r

    @action(detail=True, methods=["post"])
    def devolvido(self, request, pk=None):
        """Devolvido ao fornecedor: sai do parque e as afectações deixam de ir além desta data."""
        pedido = self.get_object()
        if pedido.estado != "chegou":
            return Response({"detail": "Só um meio que chegou pode ser devolvido."}, status=409)
        data = _data(request.data.get("data")) or timezone.localdate()
        if pedido.chegou_em and data < pedido.chegou_em:
            return Response({"data": ["A devolução não pode ser antes da chegada."]}, status=400)
        with transaction.atomic():
            if pedido.meio:
                meio = pedido.meio
                meio.activo, meio.actualizado_por = False, request.user
                meio.save(update_fields=["activo", "actualizado_por", "actualizado_em"])
                meio.alocacoes.filter(data_inicio__gt=data).delete()
                meio.alocacoes.filter(data_fim__gt=data).update(data_fim=data)
            pedido.estado, pedido.devolvido_em, pedido.actualizado_por = "devolvido", data, request.user
            pedido.save()
        return self._resposta(pedido)

    @action(detail=True, methods=["post"])
    def anular(self, request, pk=None):
        pedido = self.get_object()
        if pedido.estado not in ("pedido", "encomendado"):
            return Response({"detail": "Um meio que já chegou não se anula: registe a devolução."}, status=409)
        pedido.estado, pedido.actualizado_por = "anulado", request.user
        pedido.save()
        return self._resposta(pedido)


# ---------------------------------------------------------------- ocupação das pessoas

class OcupacaoView(APIView):
    """Onde está cada pessoa no período: tarefas abertas em que está na equipa e eventos em que participa.
    Serve de aviso ao escolher a equipa (não bloqueia)."""
    permission_classes = [TemPerfil]

    def get(self, request):
        p = request.query_params
        ini = _data(p.get("desde")) or timezone.localdate()
        fim = _data(p.get("ate")) or ini
        if fim < ini:
            ini, fim = fim, ini
        fim = min(fim, ini + timedelta(days=MAX_DIAS))
        hi, hf = (_hora(p.get("hora_inicio")), _hora(p.get("hora_fim"))) if ini == fim else (None, None)
        excl_t = p.get("excluir_tarefa")
        excl_e = p.get("excluir_evento")
        res = {}

        def junta(pid, item):
            res.setdefault(str(pid), []).append(item)

        tarefas = (Tarefa.objects.filter(progresso__lt=100, inicio__isnull=False, inicio__lte=fim)
                   .filter(Q(fim__gte=ini) | Q(fim__isnull=True, inicio__gte=ini)).prefetch_related("equipa"))
        if excl_t:
            tarefas = tarefas.exclude(pk=excl_t)
        for t in tarefas:
            for pe in t.equipa.all():
                junta(pe.id, {"tipo": "tarefa", "id": t.id, "titulo": f"{t.localizacao} — {t.descricao}",
                              "periodo": _periodo_txt(t.inicio, t.fim or t.inicio)})

        from .agenda import eventos_no_intervalo
        evs = (eventos_no_intervalo(ini, fim).exclude(estado="cancelado").exclude(tipo="prazo")
               .prefetch_related("participantes"))
        if excl_e:
            evs = evs.exclude(pk=excl_e)
        for e in evs:
            dur = ((e.data_fim or e.data) - e.data).days
            for d0 in ocorrencias(e, ini, fim):
                d1 = d0 + timedelta(days=dur)
                if sobrepoe(ini, fim, hi, hf, d0, d1, e.hora_inicio if not dur else None, e.hora_fim if not dur else None):
                    for pe in e.participantes.all():
                        junta(pe.id, {"tipo": e.tipo, "id": e.id, "titulo": e.titulo,
                                      "periodo": _periodo_txt(d0, d1, e.hora_inicio if not dur else None,
                                                              e.hora_fim if not dur else None)})
        return Response({"desde": ini, "ate": fim, "pessoas": res})
