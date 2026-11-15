"""Agenda: reuniões, visitas/intervenções e prazos, mais as tarefas do planeamento.

    /api/eventos/                               CRUD (Técnico cria e altera, só Administrador elimina)
    /api/eventos/<id>/excluir-ocorrencia/       POST {"data": "AAAA-MM-DD"}: tira um dia de uma série
    /api/eventos/conflitos/?data=…&participantes=1,2&hora_inicio=…  pessoas já ocupadas (aviso, não bloqueia)
    /api/agenda/?desde=…&ate=…                  tudo o que cai no intervalo, eventos e tarefas juntos
                &minha=1  &pessoa=<id>  &tipo=reuniao|visita|prazo|tarefa  &sitio=<id>  &tarefas=0

Conflito = a mesma pessoa em dois eventos (reunião ou visita, não cancelados) no mesmo dia com horas
que se sobrepõem; um evento sem hora ocupa o dia inteiro. Prazos e tarefas não contam.
"""
from datetime import date, time, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Evento, Pessoa, Tarefa
from .permissions import TarefaPermission, TemPerfil
from .serializers import TarefaSerializer, nome_utilizador, texto_equipa

MAX_DIAS = 62            # um mês de calendário com as semanas incompletas cabe com folga
JANELA_CONFLITOS = 56    # numa série, verifica as ocorrências das próximas 8 semanas


def _data(valor):
    try:
        return date.fromisoformat(valor) if valor else None
    except ValueError:
        return None


def _hora(valor):
    try:
        return time.fromisoformat(valor) if valor else None
    except ValueError:
        return None


def _dias(ev):
    return {int(x) for x in (ev.dias_semana or "").split(",") if x.strip().isdigit()}


def ocorrencias(ev, desde, ate):
    """Datas de início de cada ocorrência do evento que tocam [desde, ate]."""
    duracao = ((ev.data_fim or ev.data) - ev.data).days
    if not ev.repeticao:
        if ev.data <= ate and ev.data + timedelta(days=duracao) >= desde:
            yield ev.data
        return
    fim = min(ate, ev.repetir_ate) if ev.repetir_ate else ate
    excl = set(ev.excepcoes or [])
    n = max(1, ev.intervalo or 1)
    dias = _dias(ev) or {ev.data.weekday()}
    d = max(ev.data, desde - timedelta(days=duracao))
    while d <= fim:
        ok = False
        if ev.repeticao == "diaria":
            ok = d.weekday() < 5
        elif ev.repeticao == "semanal":
            semanas = (d - timedelta(days=d.weekday()) - (ev.data - timedelta(days=ev.data.weekday()))).days // 7
            ok = d.weekday() in dias and semanas % n == 0
        elif ev.repeticao == "mensal":
            meses = (d.year - ev.data.year) * 12 + d.month - ev.data.month
            ok = d.day == ev.data.day and meses % n == 0
        if ok and d.isoformat() not in excl:
            yield d
        d += timedelta(days=1)


def _faixa(hi, hf):
    """Minutos ocupados num dia: sem hora = dia inteiro; sem fim = 1 hora."""
    if not hi:
        return 0, 24 * 60
    a = hi.hour * 60 + hi.minute
    b = hf.hour * 60 + hf.minute if hf else a + 60
    return a, max(b, a + 1)


def ocupacoes(ev, desde, ate):
    """(dia, início, fim) de cada dia ocupado pelo evento no intervalo. Prazos e cancelados não ocupam."""
    if ev.tipo == "prazo" or ev.estado == "cancelado":
        return
    duracao = ((ev.data_fim or ev.data) - ev.data).days
    for d0 in ocorrencias(ev, desde, ate):
        for k in range(duracao + 1):
            dia = d0 + timedelta(days=k)
            if desde <= dia <= ate:
                yield dia, *(_faixa(ev.hora_inicio, ev.hora_fim) if duracao == 0 else (0, 24 * 60))


def _horario(ev):
    if not ev.hora_inicio:
        return "dia inteiro"
    return f"{ev.hora_inicio:%H:%M}" + (f"–{ev.hora_fim:%H:%M}" if ev.hora_fim else "")


def eventos_no_intervalo(desde, ate):
    """Eventos (com séries) que podem ter ocorrências no intervalo — o filtro fino é feito por ocorrencias()."""
    return (Evento.objects.filter(data__lte=ate)
            .filter(Q(repeticao="", data_fim__gte=desde) | Q(repeticao="", data_fim__isnull=True, data__gte=desde)
                    | (~Q(repeticao="") & (Q(repetir_ate__isnull=True) | Q(repetir_ate__gte=desde)))))


def calcular_conflitos(eventos, desde, ate, alvo=None):
    """{(evento_id, dia): [{"pessoa", "com", "horario"}]}. Se `alvo` (evento por gravar) for dado,
    devolve só os conflitos dele com os outros."""
    ocup = {}  # (pessoa_id, dia) -> [(ini, fim, ev)]
    nomes = {}
    for ev in eventos:
        if alvo is not None and ev.pk == alvo.pk:
            continue
        pessoas = list(ev.participantes.all())
        for dia, a, b in ocupacoes(ev, desde, ate):
            for p in pessoas:
                nomes[p.id] = p.nome
                ocup.setdefault((p.id, dia), []).append((a, b, ev))

    res = {}
    if alvo is not None:
        for dia, a, b in ocupacoes(alvo, desde, ate):
            for pid, pnome in alvo._pessoas:
                for a2, b2, outro in ocup.get((pid, dia), []):
                    if a < b2 and a2 < b:
                        res.setdefault((None, dia), []).append(
                            {"pessoa": pnome, "com": outro.titulo, "horario": _horario(outro), "data": dia})
        return res

    for (pid, dia), lst in ocup.items():
        for i, (a, b, ev) in enumerate(lst):
            for a2, b2, outro in lst[i + 1:]:
                if outro.pk != ev.pk and a < b2 and a2 < b:
                    res.setdefault((ev.pk, dia), []).append({"pessoa": nomes[pid], "com": outro.titulo, "horario": _horario(outro)})
                    res.setdefault((outro.pk, dia), []).append({"pessoa": nomes[pid], "com": ev.titulo, "horario": _horario(ev)})
    return res


class EventoSerializer(serializers.ModelSerializer):
    participantes = serializers.PrimaryKeyRelatedField(many=True, queryset=Pessoa.objects.filter(activo=True),
                                                       required=False)
    participantes_nomes = serializers.SerializerMethodField()
    tipo_nome = serializers.CharField(source="get_tipo_display", read_only=True)
    estado_nome = serializers.CharField(source="get_estado_display", read_only=True)
    sitio_nome = serializers.SerializerMethodField()
    tarefa_nome = serializers.SerializerMethodField()
    criado_por_nome = serializers.SerializerMethodField()
    actualizado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = Evento
        fields = ["id", "tipo", "tipo_nome", "titulo", "data", "data_fim", "hora_inicio", "hora_fim", "local",
                  "sitio", "sitio_nome", "tarefa", "tarefa_nome", "participantes", "participantes_nomes",
                  "participantes_externos", "descricao", "estado", "estado_nome",
                  "repeticao", "intervalo", "dias_semana", "repetir_ate", "excepcoes",
                  "criado_em", "criado_por_nome", "actualizado_em", "actualizado_por_nome"]
        read_only_fields = ["criado_em", "actualizado_em", "excepcoes"]

    def get_participantes_nomes(self, obj):
        return [p.nome for p in obj.participantes.all()]

    def get_sitio_nome(self, obj):
        return str(obj.sitio) if obj.sitio else None

    def get_tarefa_nome(self, obj):
        return f"{obj.tarefa.localizacao} — {obj.tarefa.descricao}" if obj.tarefa else None

    def get_criado_por_nome(self, obj):
        return nome_utilizador(obj.criado_por)

    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def validate(self, dados):
        inst = self.instance
        v = lambda k: dados.get(k, getattr(inst, k) if inst else None)  # noqa: E731
        ini, fim, hi, hf = v("data"), v("data_fim"), v("hora_inicio"), v("hora_fim")
        if fim and ini and fim < ini:
            raise serializers.ValidationError({"data_fim": "A data de fim é anterior à data de início."})
        if fim == ini:
            dados["data_fim"] = fim = None   # um só dia
        if hf and not hi:
            raise serializers.ValidationError({"hora_inicio": "Indique a hora de início."})
        if hi and hf and hf <= hi and not (fim and fim > ini):
            raise serializers.ValidationError({"hora_fim": "A hora de fim tem de ser depois da hora de início."})
        if not (v("titulo") or "").strip():
            raise serializers.ValidationError({"titulo": "Indique o título."})

        rep = v("repeticao") or ""
        if rep:
            if fim:
                raise serializers.ValidationError({"repeticao": "Um evento de vários dias não se pode repetir."})
            ate = v("repetir_ate")
            if ate and ini and ate < ini:
                raise serializers.ValidationError({"repetir_ate": "A data final da repetição é anterior ao início."})
            n = v("intervalo") or 1
            if not 1 <= n <= 12:
                raise serializers.ValidationError({"intervalo": "Entre 1 e 12."})
            if rep == "semanal":
                dias = sorted({int(x) for x in (v("dias_semana") or "").split(",") if x.strip().isdigit() and int(x) < 7})
                dados["dias_semana"] = ",".join(map(str, dias or [ini.weekday()]))
        else:
            dados["dias_semana"], dados["repetir_ate"], dados["intervalo"] = "", None, 1
        t = v("tarefa")
        if t and v("sitio") and t.sitio_id and t.sitio_id != v("sitio").id:
            raise serializers.ValidationError({"tarefa": "A tarefa escolhida é de outro sítio."})
        return dados


class EventoViewSet(viewsets.ModelViewSet):
    serializer_class = EventoSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        return (Evento.objects.select_related("sitio", "tarefa", "criado_por__pessoa", "actualizado_por__pessoa")
                .prefetch_related("participantes"))

    def perform_create(self, serializer):
        serializer.save(criado_por=self.request.user, actualizado_por=self.request.user)

    def perform_update(self, serializer):
        serializer.save(actualizado_por=self.request.user)

    @action(detail=True, methods=["post"], url_path="excluir-ocorrencia")
    def excluir_ocorrencia(self, request, pk=None):
        ev = self.get_object()
        d = _data(request.data.get("data"))
        if not ev.repeticao or d is None or d not in set(ocorrencias(ev, d, d)):
            return Response({"data": ["Esta data não é uma ocorrência da série."]}, status=400)
        ev.excepcoes = sorted(set(ev.excepcoes or []) | {d.isoformat()})
        ev.actualizado_por = request.user
        ev.save(update_fields=["excepcoes", "actualizado_por", "actualizado_em"])
        return Response(EventoSerializer(ev).data)

    @action(detail=False, methods=["get"])
    def conflitos(self, request):
        """Aviso enquanto se preenche o formulário: quem já está ocupado nesse dia/hora."""
        p = request.query_params
        d = _data(p.get("data"))
        ids = [int(x) for x in p.get("participantes", "").split(",") if x.strip().isdigit()]
        if not d or not ids:
            return Response({"conflitos": []})
        alvo = Evento(
            pk=int(p["excluir"]) if p.get("excluir", "").isdigit() else None,
            tipo=p.get("tipo") or "reuniao", estado="previsto", titulo="", data=d,
            data_fim=_data(p.get("data_fim")), hora_inicio=_hora(p.get("hora_inicio")), hora_fim=_hora(p.get("hora_fim")),
            repeticao=p.get("repeticao", ""), intervalo=int(p.get("intervalo") or 1),
            dias_semana=p.get("dias_semana", ""), repetir_ate=_data(p.get("repetir_ate")), excepcoes=[],
        )
        if alvo.pk:   # a editar: mantém os dias já retirados da série
            alvo.excepcoes = list(Evento.objects.filter(pk=alvo.pk).values_list("excepcoes", flat=True).first() or [])
        alvo._pessoas = list(Pessoa.objects.filter(id__in=ids).values_list("id", "nome"))
        ate = alvo.data_fim or (min(alvo.repetir_ate or d + timedelta(days=JANELA_CONFLITOS),
                                    d + timedelta(days=JANELA_CONFLITOS)) if alvo.repeticao else d)
        outros = eventos_no_intervalo(d, ate).filter(participantes__in=ids).distinct().prefetch_related("participantes")
        res = calcular_conflitos(outros, d, ate, alvo=alvo)
        lista = sorted((c for v in res.values() for c in v), key=lambda c: (c["data"], c["pessoa"]))
        return Response({"conflitos": lista[:20], "total": len(lista)})


class AgendaViewSet(viewsets.ViewSet):
    permission_classes = [TemPerfil]

    def list(self, request):
        p = request.query_params
        hoje = timezone.localdate()
        desde = _data(p.get("desde")) or hoje - timedelta(days=hoje.weekday())
        ate = _data(p.get("ate")) or desde + timedelta(days=13)
        if ate < desde:
            desde, ate = ate, desde
        ate = min(ate, desde + timedelta(days=MAX_DIAS))

        pessoa_id = p.get("pessoa")
        if p.get("minha") == "1":
            pessoa = getattr(request.user, "pessoa", None)
            pessoa_id = pessoa.id if pessoa else -1   # conta sem pessoa: agenda vazia
        tipo, sitio = p.get("tipo"), p.get("sitio")

        itens = []

        if tipo in (None, "", "reuniao", "visita", "prazo"):
            todos = list(eventos_no_intervalo(desde, ate).select_related("sitio", "tarefa")
                         .prefetch_related("participantes", "alocacoes__meio"))
            # os conflitos olham para todos os eventos, mesmo os que os filtros escondem
            conflitos = calcular_conflitos(todos, desde, ate)
            for e in todos:
                pessoas = list(e.participantes.all())
                if tipo and e.tipo != tipo:
                    continue
                if pessoa_id and int(pessoa_id) not in {x.id for x in pessoas}:
                    continue
                if sitio and str(e.sitio_id) != str(sitio):
                    continue
                duracao = ((e.data_fim or e.data) - e.data).days
                for d in ocorrencias(e, desde, ate):
                    dias = [d + timedelta(days=k) for k in range(duracao + 1)]
                    conf = [c for dia in dias for c in conflitos.get((e.pk, dia), [])]
                    itens.append({
                        "chave": f"e{e.id}-{d.isoformat()}", "origem": "evento", "id": e.id, "tipo": e.tipo,
                        "titulo": e.titulo, "data": d, "data_fim": d + timedelta(days=duracao),
                        "hora_inicio": e.hora_inicio, "hora_fim": e.hora_fim, "local": e.local,
                        "sitio": e.sitio_id, "sitio_nome": str(e.sitio) if e.sitio else None,
                        "pessoas": [x.nome for x in pessoas], "externos": e.participantes_externos,
                        "estado": e.estado, "serie": bool(e.repeticao),
                        "tarefa": e.tarefa_id,
                        "tarefa_nome": f"{e.tarefa.localizacao} — {e.tarefa.descricao}" if e.tarefa else None,
                        "conflitos": conf,
                        "meios": sorted({a.meio.codigo for a in e.alocacoes.all()
                                         if a.data_inicio <= d + timedelta(days=duracao) and a.data_fim >= d}),
                    })

        if tipo in (None, "", "tarefa") and p.get("tarefas") != "0":
            ta = (Tarefa.objects.filter(inicio__isnull=False, inicio__lte=ate)
                  .filter(Q(fim__gte=desde) | Q(fim__isnull=True, inicio__gte=desde))
                  .select_related("sitio", "seccao").prefetch_related("equipa", "alocacoes__meio"))
            if pessoa_id:
                ta = ta.filter(equipa=pessoa_id)
            if sitio:
                ta = ta.filter(sitio_id=sitio)
            estado = TarefaSerializer().get_estado
            for t in ta.distinct():
                itens.append({
                    "chave": f"t{t.id}", "origem": "tarefa", "id": t.id, "tipo": "tarefa",
                    "titulo": f"{t.localizacao} — {t.descricao}", "data": t.inicio, "data_fim": t.fim or t.inicio,
                    "hora_inicio": None, "hora_fim": None, "local": t.localizacao,
                    "sitio": t.sitio_id, "sitio_nome": str(t.sitio) if t.sitio else None,
                    "pessoas": [x.nome for x in t.equipa.all()], "externos": t.equipa_externa,
                    "estado": estado(t), "progresso": t.progresso, "seccao": t.seccao.nome,
                    "equipa_texto": texto_equipa(t), "serie": False, "tarefa": None, "tarefa_nome": None,
                    "conflitos": [],
                    "meios": sorted({a.meio.codigo for a in t.alocacoes.all()
                                     if a.data_inicio <= ate and a.data_fim >= desde}),
                })

        itens.sort(key=lambda i: (i["data"], i["hora_inicio"] is not None, i["hora_inicio"] or "", i["origem"] != "evento"))
        return Response({"desde": desde, "ate": ate, "hoje": hoje, "itens": itens})
