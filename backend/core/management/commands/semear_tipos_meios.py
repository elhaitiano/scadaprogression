"""Catálogo inicial de tipos de meios (os do SHERT + os do trabalho SCADA). Volta a correr sem duplicar.

    python manage.py semear_tipos_meios
"""
from django.core.management.base import BaseCommand

from core.models import TipoMeio

# (nome, categoria, unidade da capacidade, descrição)
TIPOS = [
    # equipamento pesado — do SHERT
    ("Escavadora hidráulica", "pesado", "t", "Peso operacional"),
    ("Retroescavadora", "pesado", "", ""),
    ("Pá carregadora", "pesado", "m³", "Capacidade do balde"),
    ("Camião basculante", "pesado", "t", "Carga útil"),
    ("Cilindro compactador", "pesado", "t", "Peso operacional"),
    ("Motoniveladora", "pesado", "", ""),
    # equipamento pesado — trabalho SCADA
    ("Grua", "pesado", "t", "Capacidade de elevação"),
    ("Camião grua", "pesado", "t", "Capacidade da grua"),
    ("Plataforma elevatória", "pesado", "m", "Altura de trabalho"),
    ("Gerador", "pesado", "kVA", "Potência"),
    # viaturas — do SHERT
    ("Veículo ligeiro SUV", "viatura", "lugares", ""),
    ("Carrinha pick-up", "viatura", "lugares", ""),
    ("Minibus de equipa", "viatura", "lugares", ""),
    # ferramentas e instrumentos — trabalho SCADA
    ("Calibrador 4-20 mA", "ferramenta", "", "Simulação e medição de sinais analógicos"),
    ("Multímetro", "ferramenta", "", ""),
    ("Portátil de configuração", "ferramenta", "", "Com SG4000 / S4W / ferramentas dos PLC"),
    ("Caudalímetro portátil (ultrassons)", "ferramenta", "", "Verificação de caudalímetros instalados"),
    ("Escada", "ferramenta", "m", "Altura"),
]


class Command(BaseCommand):
    help = "Cria os tipos de meios que faltam no catálogo."

    def handle(self, **_):
        criados = 0
        for i, (nome, cat, un, desc) in enumerate(TIPOS):
            _, novo = TipoMeio.objects.get_or_create(
                nome=nome, defaults={"categoria": cat, "unidade": un, "descricao": desc, "ordem": i * 10})
            criados += novo
        self.stdout.write(self.style.SUCCESS(f"{criados} tipos criados · {len(TIPOS) - criados} já existiam."))
