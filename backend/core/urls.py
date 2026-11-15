from rest_framework.routers import DefaultRouter

from . import elementos, views

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

urlpatterns = router.urls