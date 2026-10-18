import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import ModeloPLC, ModeloRTU, Sitio

FICHEIRO_PADRAO = Path(__file__).resolve().parents[2] / "seed" / "catalogo.json"


class Command(BaseCommand):
    help = ("Carrega o catálogo de modelos RTU/PLC e liga cada sítio ao seu modelo de RTU. "
            "Não altera Previsto/Realizado, tarefas nem pessoas. Pode ser executado várias vezes.")

    def add_arguments(self, parser):
        parser.add_argument("--ficheiro", default=str(FICHEIRO_PADRAO))
        parser.add_argument("--forcar", action="store_true",
                            help="Substitui também modelo/instalação já preenchidos à mão.")

    @transaction.atomic
    def handle(self, *args, **opts):
        caminho = Path(opts["ficheiro"])
        if not caminho.exists():
            raise CommandError(f"Ficheiro não encontrado: {caminho}")
        dados = json.loads(caminho.read_text(encoding="utf-8"))

        rtus = {}
        for r in dados["modelos_rtu"]:
            obj, _ = ModeloRTU.objects.get_or_create(
                fabricante=r["fabricante"], modelo=r["modelo"],
                defaults={"ferramenta": r.get("ferramenta", ""), "notas": r.get("notas", "")},
            )
            rtus[obj.modelo] = obj

        n_plc = 0
        for p in dados["modelos_plc"]:
            _, novo = ModeloPLC.objects.get_or_create(
                fabricante=p["fabricante"], modelo=p["modelo"],
                defaults={"protocolos": p.get("protocolos", ""), "notas": p.get("notas", "")},
            )
            n_plc += novo

        ligados = ignorados = 0
        for nome, modelo in dados.get("sitios_rtu", {}).items():
            for sitio in Sitio.objects.filter(nome=nome):
                if sitio.modelo_rtu_id and not opts["forcar"]:
                    ignorados += 1
                    continue
                sitio.modelo_rtu = rtus[modelo]
                sitio.save(update_fields=["modelo_rtu"])
                ligados += 1

        inst = 0
        for nome, (tipo, detalhe) in dados.get("sitios_instalacao", {}).items():
            for sitio in Sitio.objects.filter(nome=nome):
                if sitio.tipo_instalacao and not opts["forcar"]:
                    continue
                sitio.tipo_instalacao, sitio.instalacao_detalhe = tipo, detalhe
                sitio.save(update_fields=["tipo_instalacao", "instalacao_detalhe"])
                inst += 1

        self.stdout.write(self.style.SUCCESS(
            f"{len(rtus)} modelos RTU · {ModeloPLC.objects.count()} modelos PLC ({n_plc} novos) · "
            f"{ligados} sítios ligados ao modelo RTU ({ignorados} já preenchidos, mantidos) · "
            f"{inst} instalações definidas"
        ))
