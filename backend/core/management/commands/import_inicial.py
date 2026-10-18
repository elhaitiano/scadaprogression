import json
import re
import unicodedata
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Actividade, Pessoa, Seccao, Sitio, SitioActividade, Tarefa

FICHEIRO_PADRAO = Path(__file__).resolve().parents[2] / "seed" / "dados_iniciais.json"


def normalizar(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().lower()


class Command(BaseCommand):
    help = "Importa os dados iniciais (secções, actividades, pessoas, sítios com P/R e tarefas S41)."

    def add_arguments(self, parser):
        parser.add_argument("--ficheiro", default=str(FICHEIRO_PADRAO),
                            help="Caminho do JSON (por defeito core/seed/dados_iniciais.json)")

    @transaction.atomic
    def handle(self, *args, **opts):
        caminho = Path(opts["ficheiro"])
        if not caminho.exists():
            raise CommandError(f"Ficheiro não encontrado: {caminho}")
        dados = json.loads(caminho.read_text(encoding="utf-8"))

        # 1. Secções
        seccoes = {}
        for s in dados["seccoes"]:
            obj, _ = Seccao.objects.update_or_create(nome=s["nome"], defaults={"ordem": s["ordem"]})
            seccoes[obj.nome] = obj

        # 2. Catálogo de actividades
        actividades = {}
        for a in dados["actividades"]:
            obj, _ = Actividade.objects.update_or_create(
                codigo=a["codigo"],
                defaults={"nome": a["nome"], "fase": a["fase"], "ordem": a["ordem"]},
            )
            actividades[obj.codigo] = obj

        # 3. Pessoas
        pessoas = {}
        for p in dados["pessoas"]:
            obj, _ = Pessoa.objects.update_or_create(nome=p["nome"], defaults={"funcao": p["funcao"]})
            pessoas[obj.nome] = obj

        # 4. Sítios + Previsto/Realizado
        indice_sitios = {}
        n_pr = 0
        for s in dados["sitios"]:
            pr = s.pop("pr")
            sitio, _ = Sitio.objects.update_or_create(tipo=s["tipo"], nome=s["nome"], defaults=s)
            indice_sitios[normalizar(f"{sitio.tipo} {sitio.nome}")] = sitio
            for codigo, (previsto, realizado) in pr.items():
                SitioActividade.objects.update_or_create(
                    sitio=sitio, actividade=actividades[codigo],
                    defaults={"previsto": previsto or 0, "realizado": realizado or 0},
                )
                n_pr += 1

        # 5. Tarefas (chave: secção + localização + descrição)
        criadas = ligadas = 0
        for t in dados["tarefas"]:
            equipa = t.pop("equipa")
            seccao = seccoes[t.pop("seccao")]
            sitio = indice_sitios.get(normalizar(t["localizacao"]))
            tarefa, nova = Tarefa.objects.update_or_create(
                seccao=seccao, localizacao=t["localizacao"], descricao=t["descricao"],
                defaults={
                    "sitio": sitio,
                    "recursos": t["recursos"],
                    "progresso": t["progresso"],
                    "inicio": t["inicio"],
                    "fim": t["fim"],
                },
            )
            tarefa.equipa.set([pessoas[n] for n in equipa])
            criadas += nova
            ligadas += sitio is not None

        self.stdout.write(self.style.SUCCESS(
            f"{len(seccoes)} secções · {len(actividades)} actividades · {len(pessoas)} pessoas · "
            f"{len(indice_sitios)} sítios ({n_pr} linhas P/R) · {len(dados['tarefas'])} tarefas "
            f"({criadas} novas, {ligadas} ligadas a um sítio)"
        ))