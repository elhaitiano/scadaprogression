from django.contrib import admin

from .models import Actividade, Pessoa, Seccao, Sitio, SitioActividade, Tarefa


class SitioActividadeInline(admin.TabularInline):
    model = SitioActividade
    extra = 0
    fields = ["actividade", "previsto", "realizado"]
    ordering = ["actividade__fase", "actividade__ordem"]


@admin.register(Sitio)
class SitioAdmin(admin.ModelAdmin):
    list_display = ["nome", "tipo", "lote", "rtu_modelo", "progresso_global"]
    list_filter = ["lote", "tipo"]
    search_fields = ["nome"]
    inlines = [SitioActividadeInline]

    @admin.display(description="Estado global")
    def progresso_global(self, obj):
        return f"{obj.progresso['global']:.0%}"


@admin.register(Actividade)
class ActividadeAdmin(admin.ModelAdmin):
    list_display = ["nome", "fase", "ordem", "codigo"]
    list_filter = ["fase"]


@admin.register(Tarefa)
class TarefaAdmin(admin.ModelAdmin):
    list_display = ["localizacao", "descricao", "seccao", "progresso", "inicio", "fim", "bloqueado"]
    list_filter = ["seccao", "bloqueado", "equipa"]
    search_fields = ["localizacao", "descricao"]
    filter_horizontal = ["equipa"]
    date_hierarchy = "inicio"


admin.site.register(Pessoa)
admin.site.register(Seccao)
admin.site.site_header = "SCADA Progression"