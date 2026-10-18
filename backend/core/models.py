from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum


class Sitio(models.Model):
    class Tipo(models.TextChoices):
        CD = "CD", "Centro de Distribuição"
        ETA = "ETA", "Estação de Tratamento"
        UCD = "UCD", "Unidade Compacta"

    class Lote(models.TextChoices):
        L1 = "L1", "Lote 1"
        L2 = "L2", "Lote 2"
        L3 = "L3", "Lote 3"

    tipo = models.CharField(max_length=3, choices=Tipo.choices)
    nome = models.CharField(max_length=80)
    lote = models.CharField(max_length=2, choices=Lote.choices)
    rtu_modelo = models.CharField("RTU (modelo)", max_length=120, blank=True)
    ferramenta = models.CharField("Ferramenta de configuração", max_length=120, blank=True)
    entradas = models.CharField("Entradas DI/AI", max_length=80, blank=True)
    ordem = models.PositiveSmallIntegerField(default=0)
    notas = models.TextField(blank=True)

    class Meta:
        ordering = ["lote", "ordem", "nome"]
        verbose_name = "sítio"
        constraints = [
            models.UniqueConstraint(fields=["tipo", "nome"], name="sitio_tipo_nome_unico"),
        ]

    def __str__(self):
        return f"{self.tipo} {self.nome}"

    def percentagem_fase(self, fase):
        tot = self.actividades.filter(actividade__fase=fase).aggregate(
            p=Sum("previsto"), r=Sum("realizado")
        )
        p, r = tot["p"] or Decimal(0), tot["r"] or Decimal(0)
        return float(r / p) if p else 0.0

    @property
    def progresso(self):
        fases = [Actividade.Fase.CONFIG, Actividade.Fase.MONTAGEM, Actividade.Fase.TESTES]
        valores = {f: self.percentagem_fase(f) for f in fases}
        valores["global"] = sum(valores.values()) / len(fases)
        return valores


class Actividade(models.Model):
    class Fase(models.TextChoices):
        CONFIG = "cfg", "1. Configuração do RTU"
        MONTAGEM = "mon", "2. Montagem física e subida de dados"
        TESTES = "tst", "3. Testes / Comissionamento"
        SDS = "sds", "4. Partilhar com SUEZ Digital Solutions"

    codigo = models.SlugField(max_length=30, unique=True)
    nome = models.CharField(max_length=120)
    fase = models.CharField(max_length=3, choices=Fase.choices)
    ordem = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["fase", "ordem"]
        verbose_name = "actividade"

    def __str__(self):
        return self.nome


class SitioActividade(models.Model):
    sitio = models.ForeignKey(Sitio, on_delete=models.CASCADE, related_name="actividades")
    actividade = models.ForeignKey(Actividade, on_delete=models.PROTECT, related_name="sitios")
    previsto = models.DecimalField(max_digits=6, decimal_places=1, default=0,
                                   validators=[MinValueValidator(0)])
    realizado = models.DecimalField(max_digits=6, decimal_places=1, default=0,
                                    validators=[MinValueValidator(0)])
    actualizado_em = models.DateTimeField(auto_now=True)
    actualizado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name="+")

    class Meta:
        verbose_name = "actividade do sítio"
        verbose_name_plural = "actividades do sítio"
        constraints = [
            models.UniqueConstraint(fields=["sitio", "actividade"], name="sitio_actividade_unica"),
        ]

    def __str__(self):
        return f"{self.sitio} · {self.actividade}"

    def clean(self):
        if self.realizado > self.previsto:
            raise ValidationError("O realizado não pode ser superior ao previsto.")


class Pessoa(models.Model):
    nome = models.CharField(max_length=80, unique=True)
    funcao = models.CharField("Função", max_length=80, blank=True)
    utilizador = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name="pessoa")
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nome"]

    def __str__(self):
        return self.nome


class Seccao(models.Model):
    nome = models.CharField(max_length=60, unique=True)
    ordem = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["ordem"]
        verbose_name = "secção"
        verbose_name_plural = "secções"

    def __str__(self):
        return self.nome


class Tarefa(models.Model):
    seccao = models.ForeignKey(Seccao, on_delete=models.PROTECT, related_name="tarefas")
    sitio = models.ForeignKey(Sitio, null=True, blank=True, on_delete=models.SET_NULL,
                              related_name="tarefas",
                              help_text="Opcional: liga a tarefa ao painel do sítio.")
    localizacao = models.CharField("Localização", max_length=120)
    descricao = models.CharField("Tarefa", max_length=255)
    equipa = models.ManyToManyField(Pessoa, blank=True, related_name="tarefas")
    recursos = models.PositiveSmallIntegerField("Recursos afectados", null=True, blank=True)
    progresso = models.PositiveSmallIntegerField(default=0,
                                                 validators=[MaxValueValidator(100)])
    inicio = models.DateField(null=True, blank=True)
    fim = models.DateField(null=True, blank=True)
    bloqueado = models.BooleanField(default=False)
    motivo_bloqueio = models.CharField(max_length=255, blank=True)
    notas = models.TextField(blank=True)
    criado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")
    criado_em = models.DateTimeField(auto_now_add=True)
    actualizado_em = models.DateTimeField(auto_now=True)
    actualizado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["seccao__ordem", "localizacao", "inicio"]

    def __str__(self):
        return f"{self.localizacao} — {self.descricao}"

    def clean(self):
        if self.inicio and self.fim and self.fim < self.inicio:
            raise ValidationError("A data de fim é anterior à data de início.")
        if self.bloqueado and not self.motivo_bloqueio:
            raise ValidationError("Indique o motivo do bloqueio.")

    @property
    def dias(self):
        if self.inicio and self.fim:
            return (self.fim - self.inicio).days + 1
        return None