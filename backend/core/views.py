from datetime import date, timedelta

from django.http import HttpResponse

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .exportar import construir_planeamento, nome_ficheiro
from .exportar_estado import construir_estado, nome_ficheiro as nome_ficheiro_estado

from .models import (Actividade, ModeloPLC, ModeloRTU, Obstaculo, Pessoa, PLCSitio, Seccao, Sitio,
                     SitioActividade, Tarefa)
from .permissions import (CatalogoPermission, SitioActividadePermission, TarefaPermission,
                          TemPerfil)
from .serializers import (ActividadeSerializer, ModeloPLCSerializer, ModeloRTUSerializer,
                          ObstaculoSerializer, PessoaSerializer, PLCSitioSerializer, SeccaoSerializer,
                          SitioActividadeSerializer, SitioDetailSerializer, SitioListSerializer,
                          TarefaSerializer, calcular_progresso)


def _data(valor):
    """Converte 'AAAA-MM-DD' em date; devolve None se vazio ou inválido."""
    try:
        return date.fromisoformat(valor) if valor else None
    except ValueError:
        return None


# ---------- Catálogo (leitura: todos · escrita: Administrador) ----------

class SeccaoViewSet(viewsets.ModelViewSet):
    queryset = Seccao.objects.all()
    serializer_class = SeccaoSerializer
    permission_classes = [CatalogoPermission]


class PessoaViewSet(viewsets.ModelViewSet):
    queryset = Pessoa.objects.all()
    serializer_class = PessoaSerializer
    permission_classes = [CatalogoPermission]


class ActividadeViewSet(viewsets.ModelViewSet):
    queryset = Actividade.objects.all()
    serializer_class = ActividadeSerializer
    permission_classes = [CatalogoPermission]

class ModeloRTUViewSet(viewsets.ModelViewSet):
    queryset = ModeloRTU.objects.all()
    serializer_class = ModeloRTUSerializer
    permission_classes = [CatalogoPermission]

class ModeloPLCViewSet(viewsets.ModelViewSet):
    queryset = ModeloPLC.objects.all()
    serializer_class = ModeloPLCSerializer
    permission_classes = [CatalogoPermission]

# ---------- Sítios ----------

class SitioViewSet(viewsets.ModelViewSet):
    """/api/sitios/?lote=L1&tipo=CD"""
    permission_classes = [CatalogoPermission]

    def get_queryset(self):
        qs = Sitio.objects.select_related("modelo_rtu").prefetch_related("actividades__actividade")
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                "actividades__actualizado_por__pessoa",
                "plcs__modelo", "plcs__modelo_substituto", "plcs__actualizado_por__pessoa",
                "obstaculos__registado_por__pessoa",
            )
        p = self.request.query_params
        if p.get("lote"):
            qs = qs.filter(lote=p["lote"])
        if p.get("tipo"):
            qs = qs.filter(tipo=p["tipo"])
        return qs

    def get_serializer_class(self):
        return SitioDetailSerializer if self.action == "retrieve" else SitioListSerializer

    @action(detail=False, methods=["get"])
    def exportar(self, request):
        """Excel no formato 'ProAgua_Estado_RTU_por_Sitio' (Estado RTU + Base de cálculo)."""
        reposta = HttpResponse(
            construir_estado(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        reposta["Content-Disposition"] = f'attachment; filename="{nome_ficheiro_estado()}"'
        return reposta


class SitioActividadeViewSet(viewsets.ModelViewSet):
    """/api/sitios-actividades/?sitio=3 — só leitura e PATCH (as linhas nascem com o sítio)."""
    serializer_class = SitioActividadeSerializer
    permission_classes = [SitioActividadePermission]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        qs = SitioActividade.objects.select_related("actividade", "actualizado_por__pessoa")
        if self.request.query_params.get("sitio"):
            qs = qs.filter(sitio_id=self.request.query_params["sitio"])
        return qs.order_by("sitio", "actividade__fase", "actividade__ordem")

class PLCSitioViewSet(viewsets.ModelViewSet):
    """/api/plcs/?sitio=3&accao=substituir — Técnico cria/altera, só Administrador elimina."""
    serializer_class = PLCSitioSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        qs = PLCSitio.objects.select_related("sitio", "modelo", "modelo_substituto",
                                             "actualizado_por__pessoa")
        p = self.request.query_params
        if p.get("sitio"):
            qs = qs.filter(sitio_id=p["sitio"])
        if p.get("accao"):
            qs = qs.filter(accao=p["accao"])
        return qs


class ObstaculoViewSet(viewsets.ModelViewSet):
    """/api/obstaculos/?sitio=3&estado=aberto&categoria=terceiros&entidade=ENDE"""
    serializer_class = ObstaculoSerializer
    permission_classes = [TarefaPermission]

    def get_queryset(self):
        qs = Obstaculo.objects.select_related("sitio", "registado_por__pessoa")
        p = self.request.query_params
        for campo in ("sitio", "estado", "categoria", "tarefa"):
            if p.get(campo):
                qs = qs.filter(**{campo: p[campo]})
        if p.get("entidade"):
            qs = qs.filter(entidade__icontains=p["entidade"])
        return qs

# ---------- Tarefas ----------

class TarefaViewSet(viewsets.ModelViewSet):
    """
    Filtros:
      ?semana=2026-10-19   janela de 14 dias a partir dessa segunda-feira (como o planeamento):
                           todas as tarefas abertas + as concluídas que caem na janela
      ?desde=…&ate=…       tarefas cujo período cruza o intervalo
      ?pessoa=<id> ?seccao=<id> ?sitio=<id>
      ?estado=concluida|bloqueada|atrasada|em_curso|planeada|sem_data
      ?abertas=1           só progresso < 100
      ?q=texto             procura na localização e na descrição
    """
    serializer_class = TarefaSerializer
    permission_classes = [TarefaPermission]

    def _semana(self):
        """Segunda-feira pedida em ?semana=; a exportação usa a semana actual por omissão"""
        d = _data(self.request.query_params.get("semana"))
        if d is None and self.action == "exportar":
            d = timezone.localdate() - timedelta(days=7)
        return d - timedelta(days=d.weekday()) if d else None

    @action(detail=False, methods=["get"])
    def exportar(self, request):
        """Excel no formato do planeamento semanal, com os mesmos filtros da lista."""
        segunda = self._semana()
        conteudo = construir_planeamento(self.get_queryset(), segunda)
        resposta = HttpResponse(
            conteudo,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        resposta["Content-Disposition"] = f'attachment; filename="{nome_ficheiro(segunda)}"'
        return resposta

    def get_queryset(self):
        qs = (Tarefa.objects
              .select_related("seccao", "sitio", "criado_por__pessoa", "actualizado_por__pessoa")
              .prefetch_related("equipa"))
        p = self.request.query_params
        hoje = timezone.localdate()

        semana = self._semana()
        if semana:
            inicio = semana
            fim = inicio + timedelta(days=13)
            qs = qs.filter(Q(progresso__lt=100) | Q(inicio__lte=fim, fim__gte=inicio))

        desde, ate = _data(p.get("desde")), _data(p.get("ate"))
        if desde:
            qs = qs.filter(fim__gte=desde)
        if ate:
            qs = qs.filter(inicio__lte=ate)

        for campo, filtro in (("pessoa", "equipa"), ("seccao", "seccao_id"), ("sitio", "sitio_id")):
            if p.get(campo):
                qs = qs.filter(**{filtro: p[campo]})

        if p.get("abertas") == "1":
            qs = qs.filter(progresso__lt=100)

        if p.get("q"):
            qs = qs.filter(Q(localizacao__icontains=p["q"]) | Q(descricao__icontains=p["q"]))

        estado = p.get("estado")
        abertas = Q(progresso__lt=100)
        filtros_estado = {
            "concluida": Q(progresso__gte=100),
            "bloqueada": abertas & Q(bloqueado=True),
            "atrasada": abertas & Q(bloqueado=False, fim__lt=hoje),
            "em_curso": abertas & Q(bloqueado=False, progresso__gt=0) & (Q(fim__gte=hoje) | Q(fim__isnull=True)),
            "planeada": abertas & Q(bloqueado=False, progresso=0, inicio__isnull=False, fim__gte=hoje),
            "sem_data": abertas & Q(bloqueado=False, progresso=0, inicio__isnull=True),
        }
        if estado in filtros_estado:
            qs = qs.filter(filtros_estado[estado])

        return qs.distinct().order_by("seccao__ordem", "localizacao", "inicio", "id")


# ---------- Painel (tudo o que o dashboard precisa numa só chamada) ----------

class PainelViewSet(viewsets.ViewSet):
    permission_classes = [TemPerfil]

    def list(self, request):
        hoje = timezone.localdate()
        seg = hoje - timedelta(days=hoje.weekday())
        dom = seg + timedelta(days=6)

        # sitios = list(Sitio.objects.prefetch_related("actividades__actividade"))
        sitios = list(Sitio.objects.exclude(lote="").prefetch_related("actividades__actividade"))
        prog = {s.id: calcular_progresso(s.actividades.all()) for s in sitios}

        def media(lista):
            return round(sum(lista) / len(lista), 4) if lista else 0.0

        por_lote = {}
        for lote in ("L1", "L2", "L3"):
            g = [prog[s.id]["global"] for s in sitios if s.lote == lote]
            por_lote[lote] = {"sitios": len(g), "progresso": media(g)}

        globais = [p["global"] for p in prog.values()]

        abertas = Tarefa.objects.filter(progresso__lt=100)
        atrasadas = abertas.filter(bloqueado=False, fim__lt=hoje)
        bloqueadas = abertas.filter(bloqueado=True).select_related("sitio")

        carga = []
        for pessoa in Pessoa.objects.filter(activo=True, tarefas__progresso__lt=100).distinct():
            t = pessoa.tarefas.filter(progresso__lt=100)
            carga.append({
                "id": pessoa.id,
                "nome": pessoa.nome,
                "abertas": t.count(),
                "atrasadas": t.filter(bloqueado=False, fim__lt=hoje).count(),
                "bloqueadas": t.filter(bloqueado=True).count(),
            })
        carga.sort(key=lambda c: -c["abertas"])

        return Response({
            "data": hoje,
            "progresso_global": media(globais),
            "por_lote": por_lote,
            "sitios": {
                "total": len(globais),
                "concluidos": sum(1 for g in globais if g >= 0.9999),
                "em_curso": sum(1 for g in globais if 0 < g < 0.9999),
                "nao_iniciados": sum(1 for g in globais if g == 0),
            },
            "tarefas": {
                "abertas": abertas.count(),
                "atrasadas": atrasadas.count(),
                "bloqueadas": bloqueadas.count(),
                "esta_semana": abertas.filter(inicio__lte=dom, fim__gte=seg).count(),
            },
            "carga_equipa": carga,
            "bloqueios": [
                {"id": t.id, "localizacao": t.localizacao, "descricao": t.descricao,
                 "motivo": t.motivo_bloqueio, "sitio": t.sitio_id}
                for t in bloqueadas
            ],
        })