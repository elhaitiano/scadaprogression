"""Exportação do planeamento para Excel, no formato do "Planeamento semanal de actividades"."""
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .serializers import texto_equipa

NAVY = "083C67"
NAVY_SOFT = "E3ECF6"
VERDE = "A9DC15"
CORES_BARRA = {           # cor da barra do Gantt por estado da tarefa
    "concluida": "5C9E14",
    "bloqueada": "C77A00",
    "atrasada": "C23A1F",
    "normal": NAVY,
}
FIM_DE_SEMANA = "EEF1F5"
HOJE = "EEF8D0"
LINHA = "DCE3EA"

DIAS_SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"]   # segunda … domingo
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

COLUNAS = [  # (título, largura)
    ("Localização", 24),
    ("Actividade", 58),
    ("Equipa obra", 34),
    ("Recursos\nafectados", 10),
    ("Progresso", 10),
    ("Início", 10),
    ("Fim", 10),
    ("Dias", 6),
]
N_DIAS = 14
COL_DIA0 = len(COLUNAS) + 1          # primeira coluna do Gantt (I)
ULTIMA_COL = len(COLUNAS) + N_DIAS   # V

fino = Side(style="thin", color=LINHA)
BORDA = Border(left=fino, right=fino, top=fino, bottom=fino)


def _preencher(cor):
    return PatternFill("solid", start_color=cor, end_color=cor)


def _estado(t, hoje):
    if t.progresso >= 100:
        return "concluida"
    if t.bloqueado:
        return "bloqueada"
    if t.fim and t.fim < hoje:
        return "atrasada"
    return "normal"


def _data_curta(d):
    return f"{d.day} {MESES[d.month - 1]} {d.year}"


def nome_ficheiro(segunda):
    semana = segunda.isocalendar().week
    return f"Planeamento_SCADA_S{semana:02d}_{segunda:%Y%m%d}.xlsx"


def construir_planeamento(tarefas, segunda):
    """tarefas: queryset já filtrado e ordenado (secção, localização, início). segunda: 1.º dia da janela."""
    hoje = timezone.localdate()
    dias = [segunda + timedelta(days=i) for i in range(N_DIAS)]

    wb = Workbook()
    ws = wb.active
    ws.title = f"S{segunda.isocalendar().week:02d}"
    ws.sheet_view.showGridLines = False

    for i, (_, largura) in enumerate(COLUNAS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = largura
    for c in range(COL_DIA0, ULTIMA_COL + 1):
        ws.column_dimensions[get_column_letter(c)].width = 3.6

    # ---- cabeçalho do documento ----
    ws["A1"] = "Planeamento semanal de actividades"
    ws["A1"].font = Font(name="Arial", size=18, bold=True, color=NAVY)
    ws["A2"] = getattr(settings, "PROJECTO_NOME", "ProAgua Pilar 2 - Distribuição")
    ws["A2"].font = Font(name="Arial", size=12, bold=True)
    inicio_proj = getattr(settings, "PROJECTO_INICIO", None)
    ws["A3"] = "Início do projecto"
    ws["B3"] = inicio_proj
    ws["A4"] = "Semana"
    ws["B4"] = segunda
    for ref in ("A3", "A4"):
        ws[ref].font = Font(name="Arial", size=10, color="5A6B7D")
    for ref in ("B3", "B4"):
        ws[ref].number_format = "DD/MM/YYYY"
        ws[ref].font = Font(name="Arial", size=10, bold=True)
        ws[ref].alignment = Alignment(horizontal="left")
    ws["C4"] = f"S{segunda.isocalendar().week:02d} e S{(segunda + timedelta(days=7)).isocalendar().week:02d}"
    ws["C4"].font = Font(name="Arial", size=10, bold=True, color=NAVY)

    # ---- linhas 5-7: semanas, dias, títulos ----
    for k in range(2):
        c0 = COL_DIA0 + 7 * k
        ws.merge_cells(start_row=5, start_column=c0, end_row=5, end_column=c0 + 6)
        cel = ws.cell(row=5, column=c0, value=_data_curta(dias[7 * k]))
        cel.font = Font(name="Arial", size=9, bold=True, color=NAVY)
        cel.alignment = Alignment(horizontal="center")

    for i, d in enumerate(dias):
        col = COL_DIA0 + i
        n = ws.cell(row=6, column=col, value=d.day)
        n.font = Font(name="Arial", size=8, color="5A6B7D")
        n.alignment = Alignment(horizontal="center")
        if d == hoje:
            n.fill = _preencher(VERDE)
            n.font = Font(name="Arial", size=8, bold=True)

    for i, (titulo, _) in enumerate(COLUNAS, start=1):
        ws.cell(row=7, column=i, value=titulo)
    for i, d in enumerate(dias):
        ws.cell(row=7, column=COL_DIA0 + i, value=DIAS_SEMANA[d.weekday()])
    for c in range(1, ULTIMA_COL + 1):
        cel = ws.cell(row=7, column=c)
        cel.font = Font(name="Arial", size=9, bold=True, color="FFFFFF")
        cel.fill = _preencher(NAVY)
        cel.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cel.border = BORDA
    ws.row_dimensions[7].height = 28

    # ---- tarefas, agrupadas por secção ----
    linha = 8
    seccao_actual = None
    for t in tarefas:
        if t.seccao_id != seccao_actual:
            seccao_actual = t.seccao_id
            ws.merge_cells(start_row=linha, start_column=1, end_row=linha, end_column=ULTIMA_COL)
            cel = ws.cell(row=linha, column=1, value=f"{t.seccao.nome} em curso")
            cel.font = Font(name="Arial", size=10, bold=True, color=NAVY)
            cel.fill = _preencher(NAVY_SOFT)
            cel.alignment = Alignment(vertical="center")
            ws.row_dimensions[linha].height = 18
            linha += 1

        valores = [
            t.localizacao,
            t.descricao,
            texto_equipa(t),
            t.recursos,
            (t.progresso or 0) / 100,
            t.inicio,
            t.fim,
            t.dias,
        ]
        for c, v in enumerate(valores, start=1):
            cel = ws.cell(row=linha, column=c, value=v)
            cel.font = Font(name="Arial", size=9, bold=(c == 1))
            cel.border = BORDA
            cel.alignment = Alignment(vertical="center", wrap_text=c in (2, 3),
                                      horizontal="center" if c >= 4 else "left")
        ws.cell(row=linha, column=5).number_format = "0%"
        ws.cell(row=linha, column=6).number_format = "DD/MM/YY"
        ws.cell(row=linha, column=7).number_format = "DD/MM/YY"
        if t.bloqueado and t.motivo_bloqueio:
            ws.cell(row=linha, column=2).value = f"{t.descricao}\n⚠ Bloqueado: {t.motivo_bloqueio}"

        cor_barra = CORES_BARRA[_estado(t, hoje)]
        for i, d in enumerate(dias):
            cel = ws.cell(row=linha, column=COL_DIA0 + i)
            cel.border = BORDA
            if t.inicio and t.fim and t.inicio <= d <= t.fim:
                cel.fill = _preencher(cor_barra)
            elif d == hoje:
                cel.fill = _preencher(HOJE)
            elif d.weekday() >= 5:
                cel.fill = _preencher(FIM_DE_SEMANA)
        linha += 1

    if linha == 8:
        ws.cell(row=8, column=1, value="Sem tarefas para os filtros escolhidos.").font = Font(
            name="Arial", size=10, italic=True, color="5A6B7D")
        linha = 9

    # ---- legenda ----
    linha += 1
    ws.cell(row=linha, column=1, value="Legenda").font = Font(name="Arial", size=9, bold=True)
    legenda = [("normal", "Planeada / em curso"), ("atrasada", "Atrasada"),
               ("bloqueada", "Bloqueada"), ("concluida", "Concluída")]
    for i, (estado, texto) in enumerate(legenda):
        r = linha + 1 + i
        ws.cell(row=r, column=1).fill = _preencher(CORES_BARRA[estado])
        ws.cell(row=r, column=2, value=texto).font = Font(name="Arial", size=9)

    # ---- impressão ----
    ws.freeze_panes = "A8"   # cabeçalho sempre visível ao deslocar
    ws.print_title_rows = "5:7"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.oddFooter.center.text = "Página &P de &N"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()