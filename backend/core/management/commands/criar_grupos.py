from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

from core.permissions import ADMIN, LEITOR, TECNICO

MODELOS = ["sitio", "actividade", "sitioactividade", "pessoa", "seccao", "tarefa", "modelortu", "modeloplc", "plcsitio", "obstaculo"]


def perms(*codenames):
    return Permission.objects.filter(content_type__app_label="core", codename__in=codenames)


class Command(BaseCommand):
    help = "Cria (ou actualiza) os grupos Administrador, Técnico e Leitor com as permissões Django."

    def handle(self, *args, **opts):
        ver = [f"view_{m}" for m in MODELOS]
        tudo = [f"{a}_{m}" for m in MODELOS for a in ("add", "change", "delete", "view")]

        regras = {
            ADMIN: tudo,
            TECNICO: ver + ["add_tarefa", "change_tarefa", "change_sitioactividade", "add_plcsitio", "change_plcsitio", "add_obstaculo", "change_obstaculo"],
            LEITOR: ver,
        }
        for nome, codenames in regras.items():
            grupo, _ = Group.objects.get_or_create(name=nome)
            grupo.permissions.set(perms(*codenames))
            self.stdout.write(f"{nome}: {grupo.permissions.count()} permissões")
        self.stdout.write(self.style.SUCCESS("Grupos prontos."))