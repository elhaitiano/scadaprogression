"""Cria os elementos de campo a partir do sinóptico de instrumentação (sites_elementos.json).

    python manage.py importar_sinoptico caminho/sites_elementos.json --simular
    python manage.py importar_sinoptico caminho/sites_elementos.json

- Acrescenta os sítios do sinóptico que faltam (sem lote: não entram no "Estado RTU" do Excel).
- Define o sistema de cada sítio (Sistema I, II, III…, Periféricos).
- Cria um Elemento por linha do sinóptico. "12 bombas água bruta" = 1 elemento com quantidade 12.
- Realizado inicial: para não perder o que já foi feito, o R de Montagem de cada categoria
  (folha "Base de cálculo", já importada) é repartido pelos elementos dessa categoria,
  primeiro os existentes (Conservar/Ligar/Reparar), depois os a instalar/substituir.
  Esses elementos ficam marcados "a confirmar" até alguém os verificar no terreno.

Volta a correr sem duplicar: só cria o que falta e nunca mexe em elementos já existentes.
"""
import json
import re
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Actividade, Elemento, Sitio, SitioActividade

# sítios que ficaram com outra empresa (ver decisão do projecto)
EXCLUIDOS = {"CD Sapu", "CD Camama", "ETA Luanda Sudeste"}

SISTEMAS = {label: value for value, label in Sitio.Sistema.choices}

# nome no sinóptico -> (tipo, nome na base de dados) quando não basta tirar o prefixo
NOMES = {
    "CD Marçal": ("CD", "Marçal"),
    "CD KM 9": ("CD", "KM9"),
    "CD KM 44": ("CD", "KM44"),
    "CD Morar I": ("CD", "Morar 1"),
    "UCD Zango": ("UCD", "Zango"),
    "UCD Kilamba": ("UCD", "Kilamba"),
}
ACCOES = {label: value for value, label in Elemento.Accao.choices}
CATEGORIAS = {"Status de energia": "alim", "Caudal": "caud", "Pressão": "pres",
              "Nível": "niv", "Qualidade da água": "qual"}
# ordem de preenchimento do realizado herdado: primeiro o que já existia no terreno
PRIORIDADE = {"conservar": 0, "ligar": 1, "reparar": 2, "por_definir": 3, "substituir": 4, "instalar": 5}


def tipo_e_nome(nome_sinoptico, grupo):
    if nome_sinoptico == "ETA Kikuxi":          # no projecto são dois sítios
        return "ETA", ("Kikuxi 1" if grupo == "Fase 1" else "Kikuxi 2")
    if nome_sinoptico in NOMES:
        return NOMES[nome_sinoptico]
    m = re.match(r"^(CD|ETA|UCD)\s+(.+)$", nome_sinoptico)
    if not m:
        raise CommandError(f"Nome de sítio não reconhecido: {nome_sinoptico!r}")
    return m.group(1), m.group(2)


def categoria(el):
    if el["t"] == "Status das bombas":
        # bombas de CD (sem indicação de água) são de água tratada
        return "bab" if el["ag"] == "Água bruta" else "bat"
    try:
        return CATEGORIAS[el["t"]]
    except KeyError:
        raise CommandError(f"Tipo de elemento desconhecido: {el['t']!r}")


def quantidade(nome):
    m = re.match(r"^(\d+)\s", nome)
    return int(m.group(1)) if m else 1


class Command(BaseCommand):
    help = "Importa os elementos de campo do sinóptico de instrumentação (sites_elementos.json)."

    def add_arguments(self, parser):
        parser.add_argument("ficheiro")
        parser.add_argument("--simular", action="store_true")
        parser.add_argument("--sem-realizado", action="store_true",
                            help="Não reparte o realizado do Excel pelos elementos (começa tudo a 0).")

    def handle(self, ficheiro, simular, sem_realizado, **_):
        try:
            with open(ficheiro, encoding="utf-8") as f:
                dados = json.load(f)
        except Exception as e:
            raise CommandError(f"Não foi possível ler {ficheiro}: {e}")

        actividades = list(Actividade.objects.all())
        mon = {a.codigo: a for a in actividades if a.fase == "mon"}
        sitios = {(s.tipo, s.nome): s for s in Sitio.objects.all()}
        novos_sitios, sistemas, criados, herdados = [], 0, 0, 0

        with transaction.atomic():
            # ---- 1. sítios e sistemas ----
            por_sitio = {}
            for bloco in dados:
                if bloco["nome"] in EXCLUIDOS:
                    continue
                sistema = SISTEMAS.get(bloco.get("sis", ""), "")
                grupos = {el["g"] for el in bloco["els"]} or {""}
                for g in sorted(grupos):
                    tipo, nome = tipo_e_nome(bloco["nome"], g)
                    s = sitios.get((tipo, nome))
                    if s is None:
                        s = Sitio(tipo=tipo, nome=nome, lote="", sistema=sistema, ordem=900)
                        if not simular:
                            s.save()
                            SitioActividade.objects.bulk_create(
                                [SitioActividade(sitio=s, actividade=a) for a in actividades])
                        sitios[(tipo, nome)] = s
                        novos_sitios.append(f"{tipo} {nome}")
                    elif sistema and s.sistema != sistema:
                        s.sistema = sistema
                        sistemas += 1
                        if not simular:
                            s.save(update_fields=["sistema"])
                    for i, el in enumerate(bloco["els"]):
                        if el["g"] == g or (not el["g"] and g == ""):
                            por_sitio.setdefault((tipo, nome), []).append((i, el))

            # ---- 2. elementos ----
            for chave, linhas in por_sitio.items():
                s = sitios[chave]
                existentes = set() if simular and s.pk is None else set(
                    Elemento.objects.filter(sitio=s).values_list("grupo", "nome"))
                # o Kikuxi foi dividido em dois sítios: o grupo deixa de ser necessário
                grupo_guardado = (lambda g: "") if s.nome in ("Kikuxi 1", "Kikuxi 2") else (lambda g: g)
                novos = []
                for ordem, el in linhas:
                    g = grupo_guardado(el["g"])
                    if (g, el["n"]) in existentes:
                        continue
                    accao = ACCOES.get(el["a"], "por_definir")
                    novos.append(Elemento(
                        sitio=s, grupo=g, categoria=categoria(el),
                        agua={"Água bruta": "bruta", "Água tratada": "tratada"}.get(el["ag"], ""),
                        nome=el["n"], quantidade=quantidade(el["n"]), accao_prevista=accao,
                        estado_fisico="por_instalar" if accao in ("instalar", "substituir") else "existente",
                        ordem=ordem,
                    ))
                criados += len(novos)

                # ---- 3. realizado herdado do Excel, repartido por categoria ----
                if not sem_realizado and s.pk:
                    r_excel = {sa.actividade.codigo: sa.realizado for sa in
                               SitioActividade.objects.filter(sitio=s, actividade__fase="mon")
                               .select_related("actividade")}
                    for cod in mon:
                        resto = int(r_excel.get(cod, Decimal(0)))
                        alvo = sorted((e for e in novos if e.categoria == cod),
                                      key=lambda e: (PRIORIDADE[e.accao_prevista], e.ordem))
                        for e in alvo:
                            if resto <= 0:
                                break
                            e.concluidos = min(e.quantidade, resto)
                            resto -= e.concluidos
                            e.a_confirmar = True
                            if e.estado_fisico == "por_instalar":
                                e.estado_fisico = "substituido" if e.accao_prevista == "substituir" else "instalado"
                            herdados += 1
                        if resto > 0:
                            self.stderr.write(self.style.WARNING(
                                f"  {s.tipo} {s.nome}: {mon[cod].nome} — R do Excel excede o sinóptico em {resto}; "
                                f"acrescente o elemento em falta na ficha do sítio."))
                if not simular:
                    Elemento.objects.bulk_create(novos)

            if simular:
                transaction.set_rollback(True)

        for n in novos_sitios:
            self.stdout.write(f"  sítio novo: {n} (sem lote)")
        accao = "seriam" if simular else "foram"
        self.stdout.write(self.style.SUCCESS(
            f"{len(novos_sitios)} sítios {accao} criados · {sistemas} sistemas {accao} definidos · "
            f"{criados} elementos {accao} criados · {herdados} com realizado herdado do Excel (a confirmar)."
            + (" (simulação: nada gravado)" if simular else "")))