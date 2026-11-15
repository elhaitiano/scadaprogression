"""Exportação do estado das RTU no formato do Excel "ProAgua_Estado_RTU_por_Sitio".

Duas folhas, como o original:
- "Estado RTU": uma linha por sítio, agrupada por lote, com as % ligadas por fórmula à outra folha;
- "Base de cálculo": P/R de cada actividade por sítio e as % de cada fase (ΣR ÷ ΣP).
As fórmulas ficam vivas: quem alterar um R no Excel vê as % recalculadas.
"""
from io import BytesIO

from django.utils import timezone
from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

from .models import Actividade, Sitio, SitioActividade

NAVY, NAVY_SOFT, BRANCO = "083C67", "E3ECF6", "FFFFFF"
OK, OK_SOFT = "2E7D32", "D9F2D0"
CURSO, CURSO_SOFT = "0B5CAD", "DCEBFA"
ZERO, ZERO_SOFT = "6B7785", "EEF1F5"
LINHA = "DCE3EA"

FASES = [("cfg", "1. Configuração do RTU"),
         ("mon", "2. Montagem física e subida de dados  (P = pontos do sinóptico)"),
         ("tst", "3. Testes / Comissionamento"),
         ("sds", "4. Partilhar com SUEZ DIGITAL SOLUTIONS")]
ROTULO_PCT = {"cfg": "% Configuração", "mon": "% Montagem e subida de dados", "tst": "% Testes / Comissionamento"}
LOTES = [("L1", "LOTE 1 — Foco actual"), ("L2", "LOTE 2"), ("L3", "LOTE 3")]

fino = Side(style="thin", color=LINHA)
BORDA = Border(left=fino, right=fino, top=fino, bottom=fino)


def _fill(cor):
    return PatternFill("solid", start_color=cor, end_color=cor)


def _f(size=9, bold=False, cor="1A2733", italic=False):
    return Font(name="Arial", size=size, bold=bold, color=cor, italic=italic)


def nome_ficheiro():
    return f"ProAgua_Estado_RTU_por_Sitio_{timezone.localdate():%Y%m%d}.xlsx"


def _base_de_calculo(ws, sitios, actividades, valores):
    """Escreve a folha de cálculo e devolve {sitio_id: {fase: 'Ref' da célula %}}."""
    ws.sheet_view.showGridLines = False
    ws["A1"] = "ProÁgua – Pilar 2  |  Base de cálculo (P/R) — actividades por sítio segundo o sinóptico de instrumentação"
    ws["A1"].font = _f(13, True, NAVY)
    ws["A2"] = ("P = Previsto (nº de pontos/itens segundo o sinóptico)  ·  R = Realizado (feitos/verificados).  "
                "% de cada indicador = ΣR ÷ ΣP.  Editar apenas R (e P se necessário).")
    ws["A2"].font = _f(9, italic=True, cor="5A6B7D")
    ws.column_dimensions["A"].width = 44
    ws["A3"], ws["A4"] = "Actividade", ""

    cols = {}  # sitio_id -> coluna do P
    for i, s in enumerate(sitios):
        cp = 2 + 2 * i
        cols[s.id] = cp
        ws.merge_cells(start_row=3, start_column=cp, end_row=3, end_column=cp + 1)
        ws.cell(3, cp, s.nome)
        ws.cell(4, cp, "P")
        ws.cell(4, cp + 1, "R")
        ws.column_dimensions[L(cp)].width = 5.5
        ws.column_dimensions[L(cp + 1)].width = 5.5
    ultima = 1 + 2 * len(sitios)
    for r in (3, 4):
        for c in range(1, ultima + 1):
            cel = ws.cell(r, c)
            cel.font = _f(9, True, BRANCO)
            cel.fill = _fill(NAVY)
            cel.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cel.border = BORDA
    ws.row_dimensions[3].height = 30

    refs = {s.id: {} for s in sitios}
    linha = 5
    for fase, titulo in FASES:
        acts = actividades.get(fase, [])
        if not acts:
            continue
        ws.merge_cells(start_row=linha, start_column=1, end_row=linha, end_column=ultima)
        ws.cell(linha, 1, titulo).font = _f(10, True, NAVY)
        ws.cell(linha, 1).fill = _fill(NAVY_SOFT)
        linha += 1
        primeira = linha
        for a in acts:
            ws.cell(linha, 1, a.nome).font = _f(9)
            ws.cell(linha, 1).border = BORDA
            for s in sitios:
                p, r = valores.get((s.id, a.id), (0, 0))
                cp = cols[s.id]
                for c, v in ((cp, p), (cp + 1, r)):
                    cel = ws.cell(linha, c, float(v) if v % 1 else int(v))
                    cel.font = _f(9, bold=(c == cp + 1), cor="1A2733" if c == cp else NAVY)
                    cel.alignment = Alignment(horizontal="center")
                    cel.border = BORDA
            linha += 1
        ultima_act = linha - 1
        if fase in ROTULO_PCT:
            ws.cell(linha, 1, ROTULO_PCT[fase]).font = _f(9, True, NAVY)
            for s in sitios:
                cp = cols[s.id]
                P, R = L(cp), L(cp + 1)
                ws.merge_cells(start_row=linha, start_column=cp, end_row=linha, end_column=cp + 1)
                cel = ws.cell(linha, cp, f"=IFERROR(SUM({R}{primeira}:{R}{ultima_act})/SUM({P}{primeira}:{P}{ultima_act}),0)")
                cel.number_format = "0%"
                cel.font = _f(9, True, NAVY)
                cel.alignment = Alignment(horizontal="center")
                refs[s.id][fase] = f"{P}{linha}"
            for c in range(1, ultima + 1):
                ws.cell(linha, c).fill = _fill(NAVY_SOFT)
                ws.cell(linha, c).border = BORDA
            linha += 1

    ws.cell(linha, 1, "Estado global (calculado)").font = _f(10, True, BRANCO)
    for s in sitios:
        cp = cols[s.id]
        ws.merge_cells(start_row=linha, start_column=cp, end_row=linha, end_column=cp + 1)
        partes = ",".join(refs[s.id][f] for f in ("cfg", "mon", "tst") if f in refs[s.id])
        cel = ws.cell(linha, cp, f"=AVERAGE({partes})")
        cel.number_format = "0%"
        cel.font = _f(9, True, BRANCO)
        cel.alignment = Alignment(horizontal="center")
    for c in range(1, ultima + 1):
        ws.cell(linha, c).fill = _fill(NAVY)
    ws.freeze_panes = "B5"
    return refs


def _estado_rtu(ws, sitios, refs, folha_base):
    ws.sheet_view.showGridLines = False
    larguras = [7, 16, 6, 30, 26, 22, 15, 17, 16, 11]
    for i, w in enumerate(larguras, start=1):
        ws.column_dimensions[L(i)].width = w

    ws.merge_cells("A1:J1")
    ws["A1"] = "ProÁgua – Pilar 2 (Distribuição)   |   Estado de Configuração e Comissionamento dos RTU"
    ws["A1"].font = _f(14, True, NAVY)
    ws.merge_cells("A2:J2")
    ws["A2"] = (f"SUEZ International  ·  Cliente: EPAL-EP  ·  % derivadas da folha '{folha_base}' (sinóptico)  ·  "
                f"Exportado do SCADA Progression em {timezone.localdate():%d/%m/%Y}")
    ws["A2"].font = _f(9, italic=True, cor="5A6B7D")

    cab = ["Tipo", "Sítio", "Lote", "RTU (modelo)", "Ferramenta de\nconfiguração", "Entradas DI/AI\n(verif. / módulo)",
           "1. Configuração\ndo RTU", "2. Montagem física\ne subida de dados", "3. Testes\n(Comissionamento)", "Estado\nglobal"]
    for c, t in enumerate(cab, start=1):
        cel = ws.cell(5, c, t)
        cel.font = _f(9, True, BRANCO)
        cel.fill = _fill(NAVY)
        cel.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cel.border = BORDA
    ws.row_dimensions[5].height = 32

    q = f"'{folha_base}'!"
    linha = 6
    intervalos_lote = {}
    blocos_pct = []
    for lote, titulo in LOTES:
        do_lote = [s for s in sitios if s.lote == lote]
        if not do_lote:
            continue
        ws.merge_cells(start_row=linha, start_column=1, end_row=linha, end_column=10)
        ws.cell(linha, 1, titulo).font = _f(10, True, NAVY)
        for c in range(1, 11):
            ws.cell(linha, c).fill = _fill(NAVY_SOFT)
        linha += 1
        inicio = linha
        for s in do_lote:
            valores = [s.tipo, s.nome, s.lote, s.rtu_modelo or "—", s.ferramenta or "—", s.entradas or "—"]
            for c, v in enumerate(valores, start=1):
                cel = ws.cell(linha, c, v)
                cel.font = _f(9, bold=(c == 2))
                cel.alignment = Alignment(vertical="center", wrap_text=c in (4, 5, 6),
                                          horizontal="center" if c in (1, 3) else "left")
                cel.border = BORDA
            for c, fase in ((7, "cfg"), (8, "mon"), (9, "tst")):
                ws.cell(linha, c, f"={q}{refs[s.id][fase]}" if fase in refs[s.id] else 0)
            ws.cell(linha, 10, f"=SUM(G{linha}:I{linha})/3")
            for c in range(7, 11):
                cel = ws.cell(linha, c)
                cel.number_format = "0%"
                cel.font = _f(10, bold=(c == 10))
                cel.alignment = Alignment(horizontal="center", vertical="center")
                cel.border = BORDA
            linha += 1
        intervalos_lote[lote] = (inicio, linha - 1)
        blocos_pct.append(f"G{inicio}:J{linha - 1}")

    # resumo (linha 3), como no original: Lote 1 em foco + global do projecto
    if "L1" in intervalos_lote:
        a, b = intervalos_lote["L1"]
        ws["A3"] = "Progresso Lote 1 (foco):"
        ws["D3"] = f"=AVERAGE(J{a}:J{b})"   # D é larga; em C (estreita) aparecia ###
    ws["G3"] = "Progresso global do projecto:"
    ws["J3"] = f"=AVERAGE(J7:J{linha - 1})"   # AVERAGE ignora as linhas de título de lote (vazias)
    for ref in ("A3", "G3"):
        ws[ref].font = _f(10, True, NAVY)
    for ref in ("D3", "J3"):
        ws[ref].number_format = "0.00%"
        ws[ref].font = _f(12, True, NAVY)

    # cores como no original: 100% verde · em curso azul · 0% cinzento
    for bloco in blocos_pct:
        ws.conditional_formatting.add(bloco, CellIsRule(operator="equal", formula=["1"],
                                                        fill=_fill(OK_SOFT), font=Font(color=OK, bold=True)))
        ws.conditional_formatting.add(bloco, CellIsRule(operator="equal", formula=["0"],
                                                        fill=_fill(ZERO_SOFT), font=Font(color=ZERO)))
        ws.conditional_formatting.add(bloco, CellIsRule(operator="between", formula=["0.000001", "0.999999"],
                                                        fill=_fill(CURSO_SOFT), font=Font(color=CURSO)))

    linha += 1
    ws.cell(linha, 2, "Legenda:").font = _f(9, True)
    for i, (txt, fundo, cor) in enumerate([("✔ Concluído (100%)", OK_SOFT, OK),
                                           ("◐ Em curso (>0 e <100%)", CURSO_SOFT, CURSO),
                                           ("○ Não iniciado (0%)", ZERO_SOFT, ZERO)], start=1):
        cel = ws.cell(linha + i, 2, txt)
        cel.fill, cel.font = _fill(fundo), _f(9, cor=cor)
    linha += 5
    notas = [
        "Notas:",
        f"As percentagens são calculadas na folha '{folha_base}' (modelo P/R): % = Σ Realizado ÷ Σ Previsto. "
        "O 'Previsto' resulta do sinóptico de instrumentação (nº de pontos por sítio).",
        "1. Configuração = actividades ao nível da RTU (programação, parametrização, comunicações SG4000/Topkapi/PLC, "
        "tabela de pontos, HF-Box quando aplicável).",
        "2. Montagem e subida de dados = instalação/ligação/verificação dos instrumentos por categoria.",
        "3. Testes = comissionamento dos instrumentos e da RTU ponta-a-ponta.",
        "4. Partilhar com SUEZ Digital Solutions (LACBUS, NWK/PL/PLS) é acompanhado mas não entra nas %.",
    ]
    for i, t in enumerate(notas):
        ws.merge_cells(start_row=linha + i, start_column=2, end_row=linha + i, end_column=10)
        cel = ws.cell(linha + i, 2, t)
        cel.font = _f(9, bold=(i == 0), cor="1A2733" if i == 0 else "5A6B7D")
        cel.alignment = Alignment(wrap_text=True, vertical="top")
        if i:
            ws.row_dimensions[linha + i].height = 24

    ws.freeze_panes = "C6"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def construir_estado():
    # sitios = list(Sitio.objects.order_by("lote", "ordem", "nome"))
    sitios = list(Sitio.objects.exclude(lote="").order_by("lote", "ordem", "nome"))
    actividades = {}
    for a in Actividade.objects.order_by("fase", "ordem"):
        actividades.setdefault(a.fase, []).append(a)
    valores = {(sa.sitio_id, sa.actividade_id): (sa.previsto, sa.realizado)
               for sa in SitioActividade.objects.all()}

    wb = Workbook()
    estado = wb.active
    estado.title = "Estado RTU"
    base = wb.create_sheet("Base de cálculo")
    refs = _base_de_calculo(base, sitios, actividades, valores)
    _estado_rtu(estado, sitios, refs, base.title)
    wb.calculation.fullCalcOnLoad = True   # o Excel recalcula tudo ao abrir

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()