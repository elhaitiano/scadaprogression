from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from .models import Actividade, Pessoa, Seccao, Sitio, SitioActividade, Tarefa

FASES_COM_PESO = ("cfg", "mon", "tst")

def calcular_progresso(linhas):
    """% por fase = Σ realizado ÷ Σ previsto; global = média das 3 fases (igual ao Excel).
    `linhas` são SitioActividade já carregadas (prefetch) para evitar uma consulta por sítio."""
    soma = {f: [Decimal(0), Decimal(0)] for f in FASES_COM_PESO}
    for l in linhas:
        fase = l.actividade.fase
        if fase in soma:
            soma[fase][0] += l.previsto
            soma[fase][1] += l.realizado
    res = {f: float(r / p) if p else 0.0 for f, (p, r) in soma.items()}
    res["global"] = sum(res[f] for f in FASES_COM_PESO) / len(FASES_COM_PESO)
    return {k: round(v, 4) for k, v in res.items()}

def nome_utilizador(user):
    if not user:
        return None
    pessoa = getattr(user, "pessoa", None)
    return pessoa.nome if pessoa else (user.get_full_name() or user.get_username())

# ------------------------ Catalogo ----------------------

class SeccaoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Seccao
        fields = ["id", "nome", "ordem"]

class PessoaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pessoa
        fields = ["id", "nome", "funcao", "ativo"]

class ActividadeSerializer(serializers.ModelSerializer):
    fase_nome = serializers.CharField(source="get_fase_display", read_only=True)

    class Meta:
        mode = Actividade
        fields = ["id", "codigo", "nome", "fase", "fase_nome", "ordem"]

# -------------------------- Previsto / Realizdo --------------------------

class SitioActividadeSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(source="actividade.codigo", read_only=True)
    actividade_nome = serializers.CharField(source="actividade.nome", read_only=True)
    fase = serializers.CharField(source="actividade.fase", read_only=True)
    actualizado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = SitioActividade
        fields = ["id", "codigo", "actividade", "codigo", "actividade_nome", "fase", "previsto", "realizado", "actualizado_em", "actualizado_por_nome"]
        read_only_fields = ["sitio", "actividade", "actualizado_em"]

    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def validate(self, attrs):
        previsto = attrs.get("previsto", getattr(self.instance, "previsto", Decimal(0)))
        realizado = attrs.get("realizado", getattr(self.instance, "realizado", Decimal(0)))
        if realizado < 0 or previsto < 0:
            raise serializers.ValidationError("Os valores não podem ser negativos.")
        if realizado > previsto:
            raise serializers.ValidationError(
                {"realizado": f"O realizado ({realizado}) não pode ultrapassar o previsto"}
            )
        return attrs

    def update(self, instance, validated_data):
        validated_data["actualizado_por"] = self.context["request"].user
        return super().update(instance, validated_data)

# -------------------------- Sitios ---------------------------

class SitioListSerializer(serializers.ModelSerializer):
    """Uma linha da matriz do painel."""
    tipo_nome = serializers.CharField(source="get_tipo_display", read_only=True)
    progresso = serializers.SerializerMethodField()

    class Meta:
        model = Sitio
        fields = ["id", "tipo", "tipo_nome", "nome", "lote", "rtu_modelo", "ferramenta",
                  "entradas", "ordem", "progresso"]

    def get_progresso(self, obj):
        return calcular_progresso(obj.actividades.all())


class SitioDetailSerializer(SitioListSerializer):
    """Ficha do sítio: P/R de todas as actividades + tarefas abertas."""
    actividades = SitioActividadeSerializer(many=True, read_only=True)
    tarefas_abertas = serializers.SerializerMethodField()

    class Meta(SitioListSerializer.Meta):
        fields = SitioListSerializer.Meta.fields + ["notas", "actividades", "tarefas_abertas"]

    def get_tarefas_abertas(self, obj):
        abertas = obj.tarefas.filter(progresso__lt=100).order_by("inicio")
        return TarefaSerializer(abertas, many=True, context=self.context).data


# ---------- Tarefas ----------

class TarefaSerializer(serializers.ModelSerializer):
    equipa = serializers.PrimaryKeyRelatedField(many=True, queryset=Pessoa.objects.filter(activo=True),
                                                required=False)
    equipa_nomes = serializers.SerializerMethodField()
    seccao_nome = serializers.CharField(source="seccao.nome", read_only=True)
    sitio_nome = serializers.SerializerMethodField()
    estado = serializers.SerializerMethodField()
    dias = serializers.IntegerField(read_only=True)
    criado_por_nome = serializers.SerializerMethodField()
    actualizado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = Tarefa
        fields = ["id", "seccao", "seccao_nome", "sitio", "sitio_nome", "localizacao", "descricao",
                  "equipa", "equipa_nomes", "recursos", "progresso", "inicio", "fim", "dias",
                  "estado", "bloqueado", "motivo_bloqueio", "notas",
                  "criado_em", "criado_por_nome", "actualizado_em", "actualizado_por_nome"]
        read_only_fields = ["criado_em", "actualizado_em"]

    def get_equipa_nomes(self, obj):
        return [p.nome for p in obj.equipa.all()]

    def get_sitio_nome(self, obj):
        return str(obj.sitio) if obj.sitio else None

    def get_criado_por_nome(self, obj):
        return nome_utilizador(obj.criado_por)

    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def get_estado(self, obj):
        if obj.progresso >= 100:
            return "concluida"
        if obj.bloqueado:
            return "bloqueada"
        if obj.fim and obj.fim < timezone.localdate():
            return "atrasada"
        if obj.progresso > 0:
            return "em_curso"
        return "planeada" if obj.inicio else "sem_data"

    def validate(self, attrs):
        inst = self.instance
        inicio = attrs.get("inicio", getattr(inst, "inicio", None))
        fim = attrs.get("fim", getattr(inst, "fim", None))
        if inicio and not fim:
            attrs["fim"] = fim = inicio
        if inicio and fim and fim < inicio:
            raise serializers.ValidationError({"fim": "A data de fim é anterior à data de início."})
        bloqueado = attrs.get("bloqueado", getattr(inst, "bloqueado", False))
        motivo = attrs.get("motivo_bloqueio", getattr(inst, "motivo_bloqueio", ""))
        if bloqueado and not motivo.strip():
            raise serializers.ValidationError({"motivo_bloqueio": "Indique o motivo do bloqueio."})
        if not bloqueado:
            attrs["motivo_bloqueio"] = ""
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        validated_data["criado_por"] = user
        validated_data["actualizado_por"] = user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data["actualizado_por"] = self.context["request"].user
        return super().update(instance, validated_data)
    