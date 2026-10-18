from rest_framework.decorators import api_view
from rest_framework.response import Response

from .permissions import perfil


@api_view(["GET"])
def eu(request):
    """Quem está ligado e com que perfil — o frontend usa isto para mostrar/esconder botões."""
    u = request.user
    pessoa = getattr(u, "pessoa", None)
    return Response({
        "id": u.id,
        "username": u.get_username(),
        "nome": pessoa.nome if pessoa else (u.get_full_name() or u.get_username()),
        "perfil": perfil(u),
    })