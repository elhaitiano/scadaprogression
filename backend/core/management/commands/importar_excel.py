"""Actualiza a base de dados a partir do Excel "ProAgua_Estado_RTU_por_Sitio".

    python manage.py importar_excel caminho/ProAgua_Estado_RTU_por_Sitio_5.xlsx --simular
    python manage.py importar_excel caminho/ProAgua_Estado_RTU_por_Sitio_5.xlsx

- Folha "Base de cálculo": valores P (previsto) e R (realizado) de cada actividade por sítio.
  As actividades são reconhecidas pela secção (1. Configuração, 2. Montagem, 3. Testes, 4. Partilhar)
  e pela ordem dentro da secção, por isso pequenas diferenças de texto não importam.
- Folha "Estado RTU": RTU (modelo), ferramenta de configuração e entradas DI/AI de cada sítio.

Só grava o que mudou. Com --simular mostra as diferenças sem gravar nada.
"""
import re
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from openpyxl import load_workbook

from core.models import Actividade, Sitio, SitioActividade

SECCOES = {"1": "cfg", "2": "mon", "3": "tst", "4": "sds"}
FOLHA_BASE = "Base de cálculo"
FOLHA_ESTADO = "Estado RTU"


def _num(v):
    if v in (None, ""):
        return Decimal(0)
    try:
        return Decimal(str(v)).quantize(Decimal("0.1"))
    except Exception:
        raise CommandError(f"Valor não numérico na folha {FOLHA_BASE}: {v!r}")


def _texto(v):
    return "" if v is None else str(v).strip()


class Command(BaseCommand):
    help = "Actualiza P/R e dados das RTU a partir do Excel ProAgua_Estado_RTU_por_Sitio."

    def add_arguments(self, parser):
        parser.add_argument("ficheiro")
        parser.add_argument("--simular", action="store_true", help="Mostra as diferenças sem gravar.")
        parser.add_argument("--sem-textos", action="store_true",
                            help="Não actualiza RTU (modelo), ferramenta e entradas.")

    def handle(self, ficheiro, simular, sem_textos, **_):
        try:
            wb = load_workbook(ficheiro, data_only=True)
        except Exception as e:
            raise CommandError(f"Não foi possível abrir {ficheiro}: {e}")
        for folha in (FOLHA_BASE, FOLHA_ESTADO):
            if folha not in wb.sheetnames:
                raise CommandError(f"Folha '{folha}' não encontrada. Folhas: {wb.sheetnames}")

        estado, base = wb[FOLHA_ESTADO], wb[FOLHA_BASE]

        # ---- sítios: nome -> (tipo, modelo, ferramenta, entradas) da folha Estado RTU ----
        linhas_estado = {}
        for r in range(1, estado.max_row + 1):
            tipo, nome = _texto(estado.cell(r, 1).value), _texto(estado.cell(r, 2).value)
            if tipo in Sitio.Tipo.values and nome:
                linhas_estado[nome] = (tipo, _texto(estado.cell(r, 4).value),
                                       _texto(estado.cell(r, 5).value), _texto(estado.cell(r, 6).value))

        sitios = {(s.tipo, s.nome): s for s in Sitio.objects.all()}

        def sitio_por_nome(nome):
            info = linhas_estado.get(nome)
            if not info:
                return None
            return sitios.get((info[0], nome))

        # ---- colunas da Base de cálculo: linha 3 tem o nome do sítio na coluna P; R está ao lado ----
        colunas = {}
        sem_correspondencia = []
        for c in range(2, base.max_column + 1):
            nome = _texto(base.cell(3, c).value)
            if not nome:
                continue
            s = sitio_por_nome(nome)
            if s is None:
                sem_correspondencia.append(nome)
            else:
                colunas[s.id] = c

        # ---- linhas: secção + ordem dentro da secção -> Actividade ----
        por_fase = {f: list(Actividade.objects.filter(fase=f).order_by("ordem")) for f in SECCOES.values()}
        linhas_act = {}   # row -> Actividade
        fase, i = None, 0
        for r in range(5, base.max_row + 1):
            rotulo = _texto(base.cell(r, 1).value)
            m = re.match(r"^(\d)\.\s", rotulo)
            if m:
                fase, i = SECCOES.get(m.group(1)), 0
                continue
            if not rotulo or rotulo.startswith("%") or rotulo.lower().startswith("estado global") or fase is None:
                continue
            if i >= len(por_fase[fase]):
                raise CommandError(f"Linha {r} ('{rotulo}'): há mais actividades no Excel do que na secção "
                                   f"'{fase}' da base de dados ({len(por_fase[fase])}).")
            linhas_act[r] = por_fase[fase][i]
            i += 1

        for f, acts in por_fase.items():
            n = sum(1 for a in linhas_act.values() if a.fase == f)
            if n != len(acts):
                raise CommandError(f"Secção '{f}': {n} linhas no Excel, {len(acts)} actividades na base de dados.")

        # ---- comparar e gravar ----
        existentes = {(sa.sitio_id, sa.actividade_id): sa for sa in SitioActividade.objects.all()}
        alteradas, criadas, textos = 0, 0, 0
        nomes = {s.id: s.nome for s in sitios.values()}

        with transaction.atomic():
            for sitio_id, col in colunas.items():
                for r, act in linhas_act.items():
                    p, rv = _num(base.cell(r, col).value), _num(base.cell(r, col + 1).value)
                    if rv > p:
                        self.stderr.write(self.style.WARNING(
                            f"  {nomes[sitio_id]} · {act.nome}: R ({rv}) > P ({p}) — R limitado a P."))
                        rv = p
                    sa = existentes.get((sitio_id, act.id))
                    if sa is None:
                        criadas += 1
                        if not simular:
                            SitioActividade.objects.create(sitio_id=sitio_id, actividade=act, previsto=p, realizado=rv)
                        continue
                    if sa.previsto != p or sa.realizado != rv:
                        alteradas += 1
                        self.stdout.write(f"  {nomes[sitio_id]:<12} {act.nome[:45]:<45} "
                                          f"P {sa.previsto}→{p}  R {sa.realizado}→{rv}")
                        if not simular:
                            sa.previsto, sa.realizado = p, rv
                            sa.save(update_fields=["previsto", "realizado", "actualizado_em"])

            if not sem_textos:
                for nome, (tipo, modelo, ferramenta, entradas) in linhas_estado.items():
                    s = sitios.get((tipo, nome))
                    if s is None:
                        continue
                    novo = {"rtu_modelo": modelo, "ferramenta": ferramenta, "entradas": entradas}
                    mud = {k: v for k, v in novo.items() if getattr(s, k) != v}
                    if mud:
                        textos += 1
                        self.stdout.write(f"  {nome:<12} " + ", ".join(f"{k}: '{getattr(s, k)}'→'{v}'" for k, v in mud.items()))
                        if not simular:
                            for k, v in mud.items():
                                setattr(s, k, v)
                            s.save(update_fields=list(mud))

            if simular:
                transaction.set_rollback(True)

        for nome in sem_correspondencia:
            self.stderr.write(self.style.WARNING(f"Sítio do Excel sem correspondência na base de dados: '{nome}'"))
        faltam = [s.nome for s in sitios.values() if s.id not in colunas]
        if faltam:
            self.stderr.write(self.style.WARNING(f"Sítios da base de dados ausentes do Excel: {', '.join(faltam)}"))

        accao = "seriam" if simular else "foram"
        self.stdout.write(self.style.SUCCESS(
            f"{len(colunas)} sítios lidos · {alteradas} valores P/R {accao} alterados · "
            f"{criadas} linhas {accao} criadas · {textos} sítios com dados de RTU {accao} actualizados."
            + (" (simulação: nada gravado)" if simular else "")
        ))