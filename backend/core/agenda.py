"""Agenda: reuniões, visitas/intervenções e prazos, mais as tarefas do planeamento.

    /api/eventos/                       CRUD dos eventos (Técnico cria e altera, só Administrador elimina)
    /api/agenda/?desde=…&ate=…          tudo o que cai no intervalo, eventos e tarefas juntos
                &minha=1                só o que envolve a pessoa do utilizador
                &pessoa=<id> &tipo=reuniao|visita|prazo|tarefa &sitio=<id>
                &tarefas=0              sem as tarefas do planeamento
"""
from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.response import Response

from .models import Evento, Pessoa, Tarefa
from .permissions import TarefaPermission, TemPerfil
from .serializers import TarefaSerializer, nome_utilizador, texto_equipa

MAX_DIAS = 62   # um mês de calendário com as semanas incompletas cabe com folga


def _data(valor):
    try:
        return date.fromisoformat(valor) if valor else None
    except ValueError:
        return None


class EventoSerializer(serializers.ModelSerializer):
    participantes = serializers.PrimaryKeyRelatedField(many=True, queryset=Pessoa.objects.filter(activo=True),
                                                       required=False)
    participantes_nomes = serializers.SerializerMethodField()
    tipo_nome = serializers.CharField(source="get_tipo_display", read_only=True)
    estado_nome = serializers.CharField(source="get_estado_display", read_only=True)
    sitio_nome = serializers.SerializerMethodField()
    criado_por_nome = serializers.SerializerMethodField()
    actualizado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = Evento
        fields = ["id", "tipo", "tipo_nome", "titulo", "data", "data_fim", "hora_inicio", "hora_fim", "local",
                  "sitio", "sitio_nome", "tarefa", "participantes", "participantes_nomes", "participantes_externos",
                  "descricao", "estado", "estado_nome", "criado_em", "criado_por_nome", "actualizado_em",
                  "actualizado_por_nome"]
        read_only_fields = ["criado_em", "actualizado_em"]

    def get_participantes_nomes(self, obj):
        return [p.nome for p in obj.participantes.all()]

    def get_sitio_nome(self, obj):
        return str(obj.sitio) if obj.sitio else None

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
            dados["data_fim"] = None   # um só dia
        if hf and not hi:
            raise serializers.ValidationError({"hora_inicio": "Indique a hora de início."})
        if hi and hf and hf <= hi and not (fim and fim > ini):
            raise serializers.ValidationError({"hora_fim": "A hora de fim tem de ser depois da hora de início."})
        if not (v("titulo") or "").strip():
            raise serializers.ValidationError({"titulo": "Indique o título."})
        return dados


class EventoViewSet(viewsets.ModelViewSet):
    serializer_class = EventoSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        return (Evento.objects.select_related("sitio", "criado_por__pessoa", "actualizado_por__pessoa")
                .prefetch_related("participantes"))

    def perform_create(self, serializer):
        serializer.save(criado_por=self.request.user, actualizado_por=self.request.user)

    def perform_update(self, serializer):
        serializer.save(actualizado_por=self.request.user)


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
            ev = (Evento.objects.filter(data__lte=ate)
                  .filter(Q(data_fim__gte=desde) | Q(data_fim__isnull=True, data__gte=desde))
                  .select_related("sitio").prefetch_related("participantes"))
            if tipo:
                ev = ev.filter(tipo=tipo)
            if pessoa_id:
                ev = ev.filter(participantes=pessoa_id)
            if sitio:
                ev = ev.filter(sitio_id=sitio)
            for e in ev.distinct():
                itens.append({
                    "chave": f"e{e.id}", "origem": "evento", "id": e.id, "tipo": e.tipo,
                    "titulo": e.titulo, "data": e.data, "data_fim": e.data_fim or e.data,
                    "hora_inicio": e.hora_inicio, "hora_fim": e.hora_fim, "local": e.local,
                    "sitio": e.sitio_id, "sitio_nome": str(e.sitio) if e.sitio else None,
                    "pessoas": [x.nome for x in e.participantes.all()],
                    "externos": e.participantes_externos, "estado": e.estado,
                })

        if tipo in (None, "", "tarefa") and p.get("tarefas") != "0":
            ta = (Tarefa.objects.filter(inicio__isnull=False, inicio__lte=ate)
                  .filter(Q(fim__gte=desde) | Q(fim__isnull=True, inicio__gte=desde))
                  .select_related("sitio", "seccao").prefetch_related("equipa"))
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
                    "equipa_texto": texto_equipa(t),
                })

        itens.sort(key=lambda i: (i["data"], i["hora_inicio"] is not None, i["hora_inicio"] or "", i["origem"] != "evento"))
        return Response({"desde": desde, "ate": ate, "hoje": hoje, "itens": itens})
