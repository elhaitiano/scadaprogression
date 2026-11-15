"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { nomeSitio, type Pessoa, type Seccao, type SitioResumo, type Tarefa } from "@/lib/planeamento";
import SeccaoMeios from "@/components/meios/SeccaoMeios";
import { textoOcupacao, useOcupacao } from "@/components/meios/useOcupacao";
import m from "@/components/meios/meios.module.css";
import s from "./planeamento.module.css";

type Erros = Record<string, string[]>;

interface Props {
  tarefa: Tarefa | null;          // null = nova tarefa
  podeEditar: boolean;            // Administrador ou Técnico
  podeEliminar: boolean;          // só Administrador
  seccoes: Seccao[];
  pessoas: Pessoa[];
  sitios: SitioResumo[];
  onFechar: () => void;
  onGuardado: () => void;
}

interface Form {
  seccao: string;
  sitio: string;
  localizacao: string;
  descricao: string;
  equipa: number[];
  equipa_externa: string;
  recursos: string;
  progresso: number;
  inicio: string;
  fim: string;
  bloqueado: boolean;
  motivo_bloqueio: string;
  notas: string;
}

function formDe(t: Tarefa | null, seccoes: Seccao[]): Form {
  return {
    seccao: String(t?.seccao ?? seccoes[0]?.id ?? ""),
    sitio: t?.sitio ? String(t.sitio) : "",
    localizacao: t?.localizacao ?? "",
    descricao: t?.descricao ?? "",
    equipa: t?.equipa ?? [],
    equipa_externa: t?.equipa_externa ?? "",
    recursos: t?.recursos != null ? String(t.recursos) : "",
    progresso: t?.progresso ?? 0,
    inicio: t?.inicio ?? "",
    fim: t?.fim ?? "",
    bloqueado: t?.bloqueado ?? false,
    motivo_bloqueio: t?.motivo_bloqueio ?? "",
    notas: t?.notas ?? "",
  };
}

function Erro({ erros, campo }: { erros: Erros; campo: string }) {
  return erros[campo]?.length ? <span className={s.erroCampo}>{erros[campo].join(" ")}</span> : null;
}

export default function DialogoTarefa({
  tarefa, podeEditar, podeEliminar, seccoes, pessoas, sitios, onFechar, onGuardado,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Form>(() => formDe(tarefa, seccoes));
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [filtroEquipa, setFiltroEquipa] = useState("");

  // o componente é montado ao abrir (ver página), por isso basta abrir o <dialog> nativo uma vez
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const so = !podeEditar; // só leitura
  const activos = pessoas.filter((p) => p.activo || form.equipa.includes(p.id));
  // onde já está cada pessoa nestas datas (aviso, não bloqueia)
  const ocupacao = useOcupacao({ desde: form.inicio, ate: form.fim || form.inicio, excluirTarefa: tarefa?.id });
  const visiveis = activos.filter((p) => p.nome.toLowerCase().includes(filtroEquipa.trim().toLowerCase()));

  function mudar<K extends keyof Form>(campo: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErros((e) => {
      const r = { ...e };
      delete r[campo];
      return r;
    });
  }

  function escolherSitio(id: string) {
    const antigo = sitios.find((x) => String(x.id) === form.sitio);
    const novo = sitios.find((x) => String(x.id) === id);
    setForm((f) => ({
      ...f,
      sitio: id,
      // preenche a localização se estava vazia ou ainda era a do sítio anterior
      localizacao: novo && (!f.localizacao || (antigo && f.localizacao === nomeSitio(antigo))) ? nomeSitio(novo) : f.localizacao,
    }));
    setErros((e) => {
      const r = { ...e };
      delete r.localizacao;
      return r;
    });
  }

  function alternarPessoa(id: number) {
    mudar("equipa", form.equipa.includes(id) ? form.equipa.filter((x) => x !== id) : [...form.equipa, id]);
  }

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (so) return;
    const locais: Erros = {};
    if (!form.localizacao.trim()) locais.localizacao = ["Indique a localização."];
    if (!form.descricao.trim()) locais.descricao = ["Descreva a actividade."];
    if (form.inicio && form.fim && form.fim < form.inicio) locais.fim = ["A data de fim é anterior à data de início."];
    if (form.bloqueado && !form.motivo_bloqueio.trim()) locais.motivo_bloqueio = ["Indique o motivo do bloqueio."];
    setErros(locais);
    if (Object.keys(locais).length) return;

    const corpo = {
      seccao: Number(form.seccao),
      sitio: form.sitio ? Number(form.sitio) : null,
      localizacao: form.localizacao.trim(),
      descricao: form.descricao.trim(),
      equipa: form.equipa,
      equipa_externa: form.equipa_externa.trim(),
      recursos: form.recursos === "" ? null : Number(form.recursos),
      progresso: form.progresso,
      inicio: form.inicio || null,
      fim: form.fim || form.inicio || null,
      bloqueado: form.bloqueado,
      motivo_bloqueio: form.bloqueado ? form.motivo_bloqueio.trim() : "",
      notas: form.notas,
    };

    setAGuardar(true);
    try {
      await api(tarefa ? `/tarefas/${tarefa.id}/` : "/tarefas/", {
        method: tarefa ? "PATCH" : "POST",
        body: JSON.stringify(corpo),
      });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) {
        setErros(Object.keys(err.campos).length ? err.campos : { non_field_errors: [err.message] });
      }
    } finally {
      setAGuardar(false);
    }
  }

  async function eliminar() {
    if (!tarefa) return;
    setAGuardar(true);
    try {
      await api(`/tarefas/${tarefa.id}/`, { method: "DELETE" });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) setErros({ non_field_errors: [err.message] });
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <dialog ref={ref} className={s.dialogo} onClose={onFechar} aria-labelledby="dlg-titulo">
      <form onSubmit={guardar} noValidate>
        <header className={s.dlgCab}>
          <div>
            <span className="eyebrow">{tarefa ? (so ? "Tarefa" : "Editar tarefa") : "Nova tarefa"}</span>
            <h2 id="dlg-titulo">{tarefa ? `${tarefa.localizacao} — ${tarefa.descricao}` : "Adicionar ao planeamento"}</h2>
          </div>
          <button type="button" className={s.fechar} onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <fieldset className={s.dlgCorpo} disabled={so || aGuardar}>
          <div className={s.grelha2}>
            <label className={s.campo}>
              Secção
              <select value={form.seccao} onChange={(e) => mudar("seccao", e.target.value)}>
                {seccoes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
              <Erro erros={erros} campo="seccao" />
            </label>
            <label className={s.campo}>
              Sítio (opcional)
              <select value={form.sitio} onChange={(e) => escolherSitio(e.target.value)}>
                <option value="">— Fora da lista de sítios —</option>
                {sitios.map((x) => <option key={x.id} value={x.id}>{nomeSitio(x)} · {x.lote}</option>)}
              </select>
            </label>
          </div>

          <label className={s.campo}>
            Localização
            <input type="text" value={form.localizacao} onChange={(e) => mudar("localizacao", e.target.value)}
                   placeholder="ex.: CD Maianga" aria-invalid={Boolean(erros.localizacao)} />
            <Erro erros={erros} campo="localizacao" />
          </label>

          <label className={s.campo}>
            Actividade
            <textarea rows={2} value={form.descricao} onChange={(e) => mudar("descricao", e.target.value)}
                      placeholder="ex.: Interligação do PLC com o RTU de telegestão"
                      aria-invalid={Boolean(erros.descricao)} />
            <Erro erros={erros} campo="descricao" />
          </label>

          <div className={s.campo}>
            <span className={s.rotuloLinha}>
              Equipa obra <small>{form.equipa.length} seleccionada(s)</small>
              {!so && (
                <input type="search" className={s.filtroEquipa} placeholder="Filtrar nomes…" value={filtroEquipa}
                       onChange={(e) => setFiltroEquipa(e.target.value)} aria-label="Filtrar equipa" />
              )}
            </span>
            <div className={s.equipa} role="group" aria-label="Equipa obra">
              {visiveis.map((p) => (
                <label key={p.id} className={s.pessoa} data-activo={form.equipa.includes(p.id)}>
                  <input type="checkbox" checked={form.equipa.includes(p.id)} onChange={() => alternarPessoa(p.id)} />
                  {p.nome}
                  {ocupacao[p.id]?.length > 0 && (
                    <span className={m.ocupado} title={textoOcupacao(ocupacao[p.id])}>
                      ocupado{ocupacao[p.id].length > 1 ? ` ×${ocupacao[p.id].length}` : ""}
                    </span>
                  )}
                </label>
              ))}
              {!pessoas.length ? (
                <span className={s.dica}>
                  A lista de pessoas não carregou{tarefa?.equipa_nomes.length ? ` — equipa actual: ${tarefa.equipa_nomes.join(", ")}` : ""}.
                </span>
              ) : (
                !visiveis.length && <span className={s.dica}>Nenhum nome corresponde ao filtro.</span>
              )}
            </div>
            <Erro erros={erros} campo="equipa" />
          </div>

          <label className={s.campo}>
            Equipa externa (opcional)
            <input type="text" value={form.equipa_externa} onChange={(e) => mudar("equipa_externa", e.target.value)}
                   placeholder="ex.: ENG CONSULT, Pilar 3A, SINO-HYDRO" />
          </label>

          <div className={s.grelha4}>
            <label className={s.campo}>
              Recursos afectados
              <input type="number" min={0} max={99} value={form.recursos}
                     onChange={(e) => mudar("recursos", e.target.value)} />
              <Erro erros={erros} campo="recursos" />
            </label>
            <label className={s.campo}>
              Início
              <input type="date" value={form.inicio} onChange={(e) => mudar("inicio", e.target.value)} />
              <Erro erros={erros} campo="inicio" />
            </label>
            <label className={s.campo}>
              Fim
              <input type="date" value={form.fim} min={form.inicio || undefined}
                     onChange={(e) => mudar("fim", e.target.value)} aria-invalid={Boolean(erros.fim)} />
              <Erro erros={erros} campo="fim" />
            </label>
            <label className={s.campo}>
              Progresso
              <span className={s.progressoCampo}>
                <input type="range" min={0} max={100} step={5} value={form.progresso}
                       onChange={(e) => mudar("progresso", Number(e.target.value))} aria-label="Progresso" />
                <input type="number" min={0} max={100} value={form.progresso}
                       onChange={(e) => mudar("progresso", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                       aria-label="Progresso em percentagem" />
                %
              </span>
              <Erro erros={erros} campo="progresso" />
            </label>
          </div>

          <label className={s.checkLinha}>
            <input type="checkbox" checked={form.bloqueado} onChange={(e) => mudar("bloqueado", e.target.checked)} />
            Tarefa bloqueada (falta material, acesso, terceiros…)
          </label>
          {form.bloqueado && (
            <label className={s.campo}>
              Motivo do bloqueio
              <input type="text" value={form.motivo_bloqueio} onChange={(e) => mudar("motivo_bloqueio", e.target.value)}
                     aria-invalid={Boolean(erros.motivo_bloqueio)} />
              <Erro erros={erros} campo="motivo_bloqueio" />
            </label>
          )}

          <label className={s.campo}>
            Notas
            <textarea rows={2} value={form.notas} onChange={(e) => mudar("notas", e.target.value)} />
          </label>

          {erros.non_field_errors && <p className={s.erro} role="alert">{erros.non_field_errors.join(" ")}</p>}

          {tarefa && (
            <p className={s.rasto}>
              Criada {tarefa.criado_por_nome ? `por ${tarefa.criado_por_nome}` : ""} em{" "}
              {new Date(tarefa.criado_em).toLocaleDateString("pt-PT")}
              {tarefa.actualizado_por_nome &&
                ` · actualizada por ${tarefa.actualizado_por_nome} em ${new Date(tarefa.actualizado_em).toLocaleDateString("pt-PT")}`}
            </p>
          )}
        </fieldset>

        {tarefa?.inicio ? (
          <SeccaoMeios alvo={{ tipo: "tarefa", id: tarefa.id }} inicio={tarefa.inicio} fim={tarefa.fim ?? tarefa.inicio}
                       equipa={pessoas.filter((p) => tarefa.equipa.includes(p.id))} podeEditar={podeEditar} />
        ) : (
          <p className={s.dica} style={{ margin: "0 20px 16px" }}>
            Meios (viaturas, ferramentas…): grave a tarefa com datas para os poder afectar.
          </p>
        )}

        <footer className={s.dlgRodape}>
          {tarefa && podeEliminar && (
            <div className={s.eliminar}>
              {confirmarEliminar ? (
                <>
                  <span>Eliminar definitivamente?</span>
                  <button type="button" className={s.btnPerigo} onClick={eliminar} disabled={aGuardar}>Sim, eliminar</button>
                  <button type="button" className="btn" onClick={() => setConfirmarEliminar(false)}>Não</button>
                </>
              ) : (
                <button type="button" className={s.btnPerigoLeve} onClick={() => setConfirmarEliminar(true)}>Eliminar</button>
              )}
            </div>
          )}
          <button type="button" className="btn" onClick={onFechar}>{so ? "Fechar" : "Cancelar"}</button>
          {!so && (
            <button type="submit" className={s.btnPrimario} disabled={aGuardar}>
              {aGuardar ? "A guardar…" : tarefa ? "Guardar alterações" : "Adicionar tarefa"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
