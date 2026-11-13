from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView # TokenRefreshView

from core.views_auth import alterar_palavra_passe, eu

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token"),
    # path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/eu/", eu, name="eu"),
    path("api/auth/eu/palavra-pase", alterar_palavra_passe, name="alterar_palavra_passe"),
    path("api/", include("core.urls")),
]