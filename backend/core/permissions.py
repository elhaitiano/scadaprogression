from rest_framework.permissions import SAFE_METHODS, BasePermission

ADMIN = "Administrador"
TECNICO = "Técnico"
LEITOR = "Leitor"


def perfil(user):
    """Devolve 'admin', 'tecnico', 'leitor' ou None para um utilizador."""
    if not user or not user.is_authenticated or not user.is_active:
        return None
    if user.is_superuser:
        return "admin"
    grupos = set(user.groups.values_list("name", flat=True))
    if ADMIN in grupos:
        return "admin"
    if TECNICO in grupos:
        return "tecnico"
    if LEITOR in grupos:
        return "leitor"
    return None


class TemPerfil(BasePermission):
    """Qualquer perfil pode ler. Utilizador sem grupo não vê nada."""
    message = "A sua conta ainda não tem um perfil atribuído."

    def has_permission(self, request, view):
        return perfil(request.user) is not None


class CatalogoPermission(TemPerfil):
    """Sítios, actividades, pessoas, secções: leitura para todos, escrita só Administrador."""
    def has_permission(self, request, view):
        p = perfil(request.user)
        if p is None:
            return False
        return request.method in SAFE_METHODS or p == "admin"


class TarefaPermission(TemPerfil):
    """Técnico cria e altera tarefas; só Administrador elimina."""
    def has_permission(self, request, view):
        p = perfil(request.user)
        if p is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == "DELETE":
            return p == "admin"
        return p in ("admin", "tecnico")


class SitioActividadePermission(TemPerfil):
    """Técnico só altera o Realizado; o Previsto (sinóptico) é reservado ao Administrador."""
    message = "Só o Administrador pode alterar o Previsto."

    def has_permission(self, request, view):
        p = perfil(request.user)
        if p is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method in ("POST", "DELETE"):
            return p == "admin"
        if p == "admin":
            return True
        return p == "tecnico" and set(request.data.keys()) <= {"realizado"}