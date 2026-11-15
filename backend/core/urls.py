from rest_framework.routers import DefaultRouter
from django.urls import path

from . import agenda, elementos, meios, views

router = DefaultRouter()
router.register("seccoes", views.SeccaoViewSet, basename="seccao")
router.register("pessoas", views.PessoaViewSet, basename="pessoa")
router.register("actividades", views.ActividadeViewSet, basename="actividade")
router.register("sitios", views.SitioViewSet, basename="sitio")
router.register("sitios-actividades", views.SitioActividadeViewSet, basename="sitioactividade")
router.register("tarefas", views.TarefaViewSet, basename="tarefa")
router.register("painel", views.PainelViewSet, basename="painel")
router.register("modelos-rtu", views.ModeloRTUViewSet, basename="modelortu")
router.register("modelos-plc", views.ModeloPLCViewSet, basename="modeloplc")
router.register("plcs", views.PLCSitioViewSet, basename="plcsitio")
router.register("obstaculos", views.ObstaculoViewSet, basename="obstaculo")
# router.register("painel", views.PainelViewSet, basename="painel")
router.register("elementos", elementos.ElementoViewSet, basename="elemento")
router.register("dashboard", elementos.DashboardViewSet, basename="dashboard")
router.register("eventos", agenda.EventoViewSet, basename="evento")
router.register("agenda", agenda.AgendaViewSet, basename="agenda")
router.register("tipos-meios", meios.TipoMeioViewSet, basename="tipomeio")
router.register("meios", meios.MeioViewSet, basename="meio")
router.register("alocacoes", meios.AlocacaoViewSet, basename="alocacao")
router.register("pedidos-meios", meios.PedidoMeioViewSet, basename="pedidomeio")

urlpatterns = [
    path("ocupacao/", meios.OcupacaoView.as_view(), name="ocupacao"),
] +router.urls