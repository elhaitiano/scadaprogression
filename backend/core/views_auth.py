from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Pessoa
from .permissions import perfil


def dados_utilizador(u):
    """O que o frontend recebe sobre quem está ligado."""
    pessoa = getattr(u, "pessoa", None)
    return {
        "id": u.id,
        "username": u.get_username(),
        "email": u.email,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "nome": pessoa.nome if pessoa else (u.get_full_name() or u.get_username()),
        "funcao": pessoa.funcao if pessoa else "",
        "tem_pessoa": pessoa is not None,
        "perfil": perfil(u),
    }


class PerfilSerializer(serializers.Serializer):
    """Campos que o próprio utilizador pode alterar. Username e email ficam de fora de propósito."""
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    nome = serializers.CharField(max_length=80, required=False)        # Pessoa.nome (nome nas equipas)
    funcao = serializers.CharField(max_length=80, required=False, allow_blank=True)

    def validate_nome(self, valor):
        valor = valor.strip()
        if not valor:
            raise serializers.ValidationError("O nome não pode ficar vazio.")
        pessoa = getattr(self.context["user"], "pessoa", None)
        repetido = Pessoa.objects.filter(nome__iexact=valor)
        if pessoa:
            repetido = repetido.exclude(pk=pessoa.pk)
        if repetido.exists():
            raise serializers.ValidationError("Já existe outra pessoa com este nome.")
        return valor

    def validate(self, dados):
        pessoa = getattr(self.context["user"], "pessoa", None)
        if pessoa is None and ("nome" in dados or "funcao" in dados):
            raise serializers.ValidationError(
                "A sua conta não está associada a uma pessoa da equipa. Contacte o administrador."
            )
        return dados

    @transaction.atomic
    def save(self):
        u = self.context["user"]
        d = self.validated_data
        for campo in ("first_name", "last_name"):
            if campo in d:
                setattr(u, campo, d[campo].strip())
        u.save(update_fields=["first_name", "last_name"])
        pessoa = getattr(u, "pessoa", None)
        if pessoa and ("nome" in d or "funcao" in d):
            if "nome" in d:
                pessoa.nome = d["nome"]
            if "funcao" in d:
                pessoa.funcao = d["funcao"].strip()
            pessoa.save(update_fields=["nome", "funcao"])
        return u


class PalavraPasseSerializer(serializers.Serializer):
    actual = serializers.CharField(trim_whitespace=False)
    nova = serializers.CharField(trim_whitespace=False)
    confirmacao = serializers.CharField(trim_whitespace=False)

    def validate_actual(self, valor):
        if not self.context["user"].check_password(valor):
            raise serializers.ValidationError("A palavra-passe actual está incorrecta.")
        return valor

    def validate(self, dados):
        if dados["nova"] != dados["confirmacao"]:
            raise serializers.ValidationError({"confirmacao": "A confirmação não coincide com a nova palavra-passe."})
        if dados["nova"] == dados["actual"]:
            raise serializers.ValidationError({"nova": "A nova palavra-passe tem de ser diferente da actual."})
        try:
            # comprimento mínimo, demasiado comum, só números, parecida com o username…
            password_validation.validate_password(dados["nova"], self.context["user"])
        except DjangoValidationError as e:
            mensagens = []
            for erro in e.error_list:
                if erro.code == "password_too_short":
                    # a tradução pt-PT do Django não cobre esta mensagem
                    minimo = (erro.params or {}).get("min_length", 8)
                    mensagens.append(f"A palavra-passe é demasiado curta: tem de ter pelo menos {minimo} caracteres.")
                else:
                    mensagens.extend(erro.messages)
            raise serializers.ValidationError({"nova": mensagens})
        return dados

    def save(self):
        u = self.context["user"]
        u.set_password(self.validated_data["nova"])
        u.save(update_fields=["password"])
        return u


@api_view(["GET", "PATCH"])
def eu(request):
    """GET: quem está ligado. PATCH: o próprio utilizador altera os seus dados (não o username nem o email)."""
    if request.method == "PATCH":
        s = PerfilSerializer(data=request.data, context={"user": request.user})
        s.is_valid(raise_exception=True)
        s.save()
        request.user.refresh_from_db()
    return Response(dados_utilizador(request.user))


@api_view(["POST"])
def alterar_palavra_passe(request):
    s = PalavraPasseSerializer(data=request.data, context={"user": request.user})
    s.is_valid(raise_exception=True)
    s.save()
    return Response(status=status.HTTP_204_NO_CONTENT)