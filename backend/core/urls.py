from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("seccoes", views.SeccaoViewSet, basename="seccao")
router.register("pessoas", views.PessoaViewSet, basename="pessoa")
router.register("actividades", views.ActividadeViewSet, basename="actividade")
router.register("sitios", views.SitioViewSet, basename="sitio")
router.register("sitios-actividades", views.SitioActividadeViewSet, basename="sitioactividade")
router.register("tarefas", views.TarefaViewSet, basename="tarefa")
router.register("painel", views.PainelViewSet, basename="painel")

urlpatterns = router.urls