from django.contrib import admin

from .models import (Actividade, ModeloPLC, ModeloRTU, Obstaculo, Pessoa, PLCSitio, Seccao, Sitio,
                     SitioActividade, Tarefa)


class SitioActividadeInline(admin.TabularInline):
    model = SitioActividade
    extra = 0
    fields = ["actividade", "previsto", "realizado"]
    ordering = ["actividade__fase", "actividade__ordem"]


class PLCSitioInline(admin.StackedInline):
    model = PLCSitio
    extra = 0
    fields = [("designacao", "modelo", "integrador"), ("accao", "modelo_substituto", "estado_substituicao"),
              "motivo_substituicao", "codigo_fonte_disponivel", "notas"]


class ObstaculoInline(admin.StackedInline):
    model = Obstaculo
    extra = 0
    fields = [("data", "categoria", "entidade", "estado"), "descricao", "impacto", "solucao", "tarefa"]


@admin.register(Sitio)
class SitioAdmin(admin.ModelAdmin):
    list_display = ["nome", "tipo", "lote", "modelo_rtu", "tipo_instalacao", "progresso_global"]
    list_filter = ["lote", "tipo", "modelo_rtu", "tipo_instalacao"]
    search_fields = ["nome"]
    fieldsets = [
        (None, {"fields": [("tipo", "nome", "lote", "ordem")]}),
        ("RTU", {"fields": [("modelo_rtu", "rtu_modelo"), ("ferramenta", "entradas")]}),
        ("Instalação física", {"fields": [("tipo_instalacao", "instalacao_detalhe")]}),
        ("Notas", {"fields": ["notas"]}),
    ]
    inlines = [PLCSitioInline, ObstaculoInline, SitioActividadeInline]

    @admin.display(description="Estado global")
    def progresso_global(self, obj):
        return f"{obj.progresso['global']:.0%}"


@admin.register(ModeloRTU)
class ModeloRTUAdmin(admin.ModelAdmin):
    list_display = ["fabricante", "modelo", "ferramenta", "activo"]
    list_filter = ["fabricante", "activo"]


@admin.register(ModeloPLC)
class ModeloPLCAdmin(admin.ModelAdmin):
    list_display = ["fabricante", "modelo", "protocolos", "activo"]
    list_filter = ["fabricante", "activo"]


@admin.register(PLCSitio)
class PLCSitioAdmin(admin.ModelAdmin):
    list_display = ["sitio", "designacao", "modelo", "integrador", "accao", "estado_substituicao"]
    list_filter = ["accao", "estado_substituicao", "modelo__fabricante"]
    search_fields = ["sitio__nome", "designacao", "integrador"]


@admin.register(Obstaculo)
class ObstaculoAdmin(admin.ModelAdmin):
    list_display = ["data", "sitio", "categoria", "entidade", "estado"]
    list_filter = ["estado", "categoria"]
    search_fields = ["sitio__nome", "entidade", "descricao"]
    date_hierarchy = "data"


@admin.register(Tarefa)
class TarefaAdmin(admin.ModelAdmin):
    list_display = ["localizacao", "descricao", "seccao", "progresso", "inicio", "fim", "bloqueado"]
    list_filter = ["seccao", "bloqueado", "equipa"]
    search_fields = ["localizacao", "descricao"]
    filter_horizontal = ["equipa"]
    date_hierarchy = "inicio"


admin.site.register([Actividade, Pessoa, Seccao])
admin.site.site_header = "SCADA Progression"