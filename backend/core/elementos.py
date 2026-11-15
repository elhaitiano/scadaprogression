"""Elementos de campo (sinóptico V9) e dashboard global do projecto.

Medida do dashboard novo, por sítio:
- Configuração e Testes: P/R das actividades (como no Estado RTU);
- Montagem: calculada a partir dos elementos de campo — P = Σ quantidade dos aplicáveis,
  R = Σ pontos concluídos — incluindo a Qualidade da água;
- Estado global = média das três fases. Progresso do projecto = média dos sítios.
As páginas "Estado RTU" (Excel) não mudam.
"""
from django.db.models import Count, F, Q, Sum
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from .models import Elemento, Sitio, SitioActividade
from .permissions import TemPerfil, perfil
from .serializers import nome_utilizador

# o que o Técnico pode alterar (andamento no terreno); o resto muda o previsto e é do Administrador
CAMPOS_TECNICO = {"estado_fisico", "concluidos", "tag", "notas"}

class ElementoPermission(TemPerfil):
    message = "Só o Administrador pode alterar o previsto (acrescentar, eliminar, N/A ou quantidade)."

    def has_permission(self, request, view):
        p = perfil(request.user)
        if p is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        if p == "admin":
            return True
        return p == "tecnico" and request.method == "PATCH" and set(request.data.keys()) <= CAMPOS_TECNICO


class ElementoSerializer(serializers.ModelSerializer):
    sitio_nome = serializers.SerializerMethodField()
    categoria_nome = serializers.CharField(source="get_categoria_display", read_only=True)
    accao_nome = serializers.CharField(source="get_accao_prevista_display", read_only=True)
    estado_fisico_nome = serializers.CharField(source="get_estado_fisico_display", read_only=True)
    actualizado_por_nome = serializers.SerializerMethodField()
    concluido = serializers.SerializerMethodField()

    class Meta:
        model = Elemento
        fields = [
            "id",
            "sitio",
            "sitio_nome",
            "grupo",
            "categoria",
            "categoria_nome",
            "agua",
            "nome",
            "tag",
            "quantidade",
            "accao_prevista",
            "accao_nome",
            "estado_fisico",
            "estado_fisico_nome",
            "concluidos",
            "concluido",
            "aplicavel",
            "motivo_na",
            "origem",
            "a_confirmar",
            "notas",
            "ordem",
            "actualizado_em",
            "actualizado_por_nome",
        ]
        read_only_fields = ["origem", "a_confirmar", "actualizado_em"]

    def get_sitio_nome(self, obj):
        return f"{obj.sitio.tipo} {obj.sitio.nome}"
        
    def get_actualizado_por_nome(self, obj):
        return nome_utilizador(obj.actualizado_por)

    def get_concluido(self, obj):
        return obj.aplicavel and obj.estado_fisico != "por_instalar" and obj.concluidos >= obj.quantidade

    def validate(self, dados):
        inst = self.instance
        q = dados.get("quantidade", inst.quantidade if inst else 1)
        c = dados.get("concluidos", inst.concluidos if inst else 0)
        est = dados.get("estado_fisico", inst.estado_fisico if inst else "existente")
        apl = dados.get("aplicavel", inst.aplicavel if inst else True)
        mot = dados.get("motivo_na", inst.motivo_na if inst else "")
        if q < 1:
            raise serializers.ValidationError({"quantidade": "A quantidade tem de ser pelo menos 1."})
        if c > q:
            raise serializers.ValidationError({"concluidos": f"No máximo {q} (a quantidade do elemento)"})
        if est == "por_instalar" and c > 0:
            raise serializers.ValidationError({"concluidos": "Um elemento por instalar não pode ter dados no RTU. Mude primeiro o estado físico."})
        if not apl and not mot.strip():
            raise serializers.ValidationError({"motivo_na": "Indique porque o elemento não se aplica."})
        return dados

class ElementoViewSet(viewsets.ModelViewSet):
    serializer_class = ElementoSerializer
    permission_classes = [ElementoPermission]

    def get_queryset(self):
        qs = Elemento.objects.select_related("sitio", "actualizado_por__pessoa")
        p = self.request.query_params
        if p.get("sitio"):
            qs = qs.filter(sitio_id=p["sitio"])
        if p.get("sistema"):
            qs = qs.filter(sitio__sistema=p["sistema"])
        if p.get("categoria"):
            qs = qs.filter(categoria=p["categoria"])
        if p.get("q"):
            qs = qs.filter(Q(nome__icontains=p["q"]) | Q(sitio__nome__icontains=p["q"]) | Q(tag__icontains=p["q"]))
        vista = p.get("vista")
        aplic = qs.filter(aplicavel=True)
        if vista == "falta_instalar":
            qs = aplic.filter(estado_fisico="por_instalar")
        elif vista == "sem_dados":          # existe no terreno mas os dados ainda não chegam (todos) ao RTU
            qs = aplic.exclude(estado_fisico="por_instalar").filter(concluidos__lt=F("quantidade"))
        elif vista == "concluidos":
            qs = aplic.exclude(estado_fisico="por_instalar").filter(concluidos=F("quantidade"))
        elif vista == "a_confirmar":
            qs = qs.filter(a_confirmar=True)
        elif vista == "na":
            qs = qs.filter(aplicavel=False)
        return qs.order_by("sitio__sistema", "sitio__nome", "grupo", "ordem", "id")

    def perform_create(self, serializer):
        serializer.save(origem="manual", actualizado_por=self.request.user)

    def perform_update(self, serializer):
        extra = {"actualizado_por": self.request.user}
        if {"concluidos", "estado_fisico"} & set(serializer.validated_data):
            extra["a_confirmar"] = False   # alguém verificou no terreno
        serializer.save(**extra)


def _media(v):
    return round(sum(v) / len(v), 4) if v else 0.0


class DashboardViewSet(viewsets.ViewSet):
    """GET /api/dashboard/ — visão global do projecto com a Montagem calculada pelos elementos."""
    permission_classes = [TemPerfil]

    def list(self, request):
        sitios = list(Sitio.objects.order_by("sistema", "nome"))

        pr = {}
        for linha in (SitioActividade.objects.filter(actividade__fase__in=["cfg", "tst"])
                      .values("sitio_id", "actividade__fase").annotate(p=Sum("previsto"), r=Sum("realizado"))):
            pr[(linha["sitio_id"], linha["actividade__fase"])] = (float(linha["p"] or 0), float(linha["r"] or 0))

        mon = {}
        for linha in (Elemento.objects.filter(aplicavel=True).values("sitio_id", "categoria")
                      .annotate(p=Sum("quantidade"), r=Sum("concluidos"))):
            mon.setdefault(linha["sitio_id"], {})[linha["categoria"]] = (linha["p"], linha["r"])

        cont = {linha["sitio_id"]: linha for linha in Elemento.objects.values("sitio_id").annotate(
            elementos=Count("id"),
            por_instalar=Count("id", filter=Q(aplicavel=True, estado_fisico="por_instalar")),
            a_confirmar=Count("id", filter=Q(a_confirmar=True)),
            na=Count("id", filter=Q(aplicavel=False)),
        )}

        def razao(p, r):
            return r / p if p else 0.0

        linhas = []
        for s in sitios:
            cats = mon.get(s.id, {})
            p_mon = sum(p for p, _ in cats.values())
            r_mon = sum(r for _, r in cats.values())
            cfg, tst = razao(*pr.get((s.id, "cfg"), (0, 0))), razao(*pr.get((s.id, "tst"), (0, 0)))
            m = razao(p_mon, r_mon)
            c = cont.get(s.id, {})
            linhas.append({
                "id": s.id, "tipo": s.tipo, "nome": s.nome, "lote": s.lote,
                "sistema": s.sistema, "sistema_nome": s.get_sistema_display() if s.sistema else "Sem sistema",
                "cfg": round(cfg, 4), "mon": round(m, 4), "tst": round(tst, 4),
                "global": round((cfg + m + tst) / 3, 4),
                "montagem": {k: {"p": p, "r": r} for k, (p, r) in cats.items()},
                "pontos": {"p": p_mon, "r": r_mon},
                "elementos": c.get("elementos", 0), "por_instalar": c.get("por_instalar", 0),
                "a_confirmar": c.get("a_confirmar", 0), "na": c.get("na", 0),
            })

        por_sistema = []
        for valor, nome in [*Sitio.Sistema.choices, ("", "Sem sistema")]:
            do_sis = [l for l in linhas if l["sistema"] == valor]
            if not do_sis:
                continue
            por_sistema.append({
                "sistema": valor, "nome": nome, "sitios": len(do_sis),
                "progresso": _media([l["global"] for l in do_sis]),
                "cfg": _media([l["cfg"] for l in do_sis]),
                "mon": _media([l["mon"] for l in do_sis]),
                "tst": _media([l["tst"] for l in do_sis]),
            })

        por_categoria = []
        for valor, nome in Elemento.Categoria.choices:
            p = sum(l["montagem"].get(valor, {}).get("p", 0) for l in linhas)
            r = sum(l["montagem"].get(valor, {}).get("r", 0) for l in linhas)
            por_categoria.append({"categoria": valor, "nome": nome, "p": p, "r": r, "progresso": round(razao(p, r), 4)})

        globais = [l["global"] for l in linhas]
        return Response({
            "data": timezone.localdate(),
            "progresso_global": _media(globais),
            "fases": {f: _media([l[f] for l in linhas]) for f in ("cfg", "mon", "tst")},
            "sitios": {
                "total": len(linhas),
                "concluidos": sum(1 for g in globais if g >= 0.9999),
                "em_curso": sum(1 for g in globais if 0 < g < 0.9999),
                "nao_iniciados": sum(1 for g in globais if g == 0),
            },
            "elementos": {
                "total": sum(l["elementos"] for l in linhas),
                "pontos_previstos": sum(l["pontos"]["p"] for l in linhas),
                "pontos_concluidos": sum(l["pontos"]["r"] for l in linhas),
                "por_instalar": sum(l["por_instalar"] for l in linhas),
                "a_confirmar": sum(l["a_confirmar"] for l in linhas),
                "na": sum(l["na"] for l in linhas),
            },
            "por_sistema": por_sistema,
            "por_categoria": por_categoria,
            "por_sitio": linhas,
        })