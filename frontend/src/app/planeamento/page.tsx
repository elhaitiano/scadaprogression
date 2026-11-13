"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError, descarregar } from "@/lib/api";
import {
  ESTADOS, diasDaJanela, inicioJanela, intervaloSemana, iso, semanaIso, somarDias, lista,
  type EstadoTarefa, type Pessoa, type RespostaLista, type Seccao, type SitioResumo, type Tarefa,
} from "@/lib/planeamento";
import CalendarioPessoas from "./CalendarioPessoas";
import DialogoTarefa from "./DialogoTarefa";
import Gantt from "./Gantt";
import s from "./planeamento.module.css";

type Vista = "gantt" | "pessoas";

interface Filtros {
  q: string;
  pessoa: string;
  seccao: string;
  estado: string;
  concluidas: boolean;
}

const FILTROS_VAZIOS: Filtros = { q: "", pessoa: "", seccao: "", estado: "", concluidas: true };
const CHAVE_VISTA = "sp_planeamento_vista";

function lerVista(): Vista {
  try {
    return window.localStorage.getItem(CHAVE_VISTA) === "pessoas" ? "pessoas" : "gantt";
  } catch {
    return "gantt";
  }
}

/** Monta a query string com os filtros que o backend conhece. */
function parametros(segunda: string, f: Filtros, q: string): string {
  const p = new URLSearchParams({ semana: segunda });
  if (q.trim()) p.set("q", q.trim());
  if (f.pessoa) p.set("pessoa", f.pessoa);
  if (f.seccao) p.set("seccao", f.seccao);
  if (f.estado) p.set("estado", f.estado);
  return p.toString();
}

export default function PaginaPlaneamento() {
  const { utilizador } = useAuth();
  const podeEditar = utilizador?.perfil === "admin" || utilizador?.perfil === "tecnico";
  const podeEliminar = utilizador?.perfil === "admin";

  const hoje = iso(new Date());
  const janelaActual = iso(inicioJanela(new Date())); // semana passada + semana actual
  const [segunda, setSegunda] = useState(janelaActual);
  // a página só é desenhada no navegador (o AuthProvider espera pela sessão), por isso pode ler o localStorage já
  const [vista, setVista] = useState<Vista>(lerVista);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [qAdiado, setQAdiado] = useState(""); // pesquisa só parte 300 ms depois de parar de escrever

  const [seccoes, setSeccoes] = useState<Seccao[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [sitios, setSitios] = useState<SitioResumo[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aExportar, setAExportar] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  // diálogo: undefined = fechado · null = nova tarefa · Tarefa = editar/ver
  const [emEdicao, setEmEdicao] = useState<Tarefa | null | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setQAdiado(filtros.q), 300);
    return () => clearTimeout(t);
  }, [filtros.q]);

  // catálogos (uma vez). Cada um carrega à parte: se um falhar, os outros continuam e o erro diz qual foi.
  useEffect(() => {
    let cancelado = false;
    async function carregar <T>(caminho: string, nome: string, guardar: (v: T[]) => void){
      try {
        const v = lista(await api<RespostaLista<T>>(caminho));
        if (!cancelado) guardar(v);
      } catch (e) {
        console.error(`[planeamento] ${caminho}`, e);
        const motivo = e instanceof Error ? e.message : String(e);
        if (!cancelado) setErro((ant) => `${ant ? ant + " . " : ""}Erro ao carregar ${nome}: ${motivo}`);
      }
    }
    carregar<Seccao>("/seccoes/", "as secções", (v) => setSeccoes([...v].sort((a, b) => a.ordem - b.ordem)));
    carregar<Pessoa>("/pessoas/", "as pessoas", (v) =>
      setPessoas([...v].sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "", "pt"))));
    carregar<SitioResumo>("/sitios/", "os sítios", setSitios);
    return() => {
      cancelado = true;
    };
  }, []);  

  // tarefas da janela de 2 semanas
  const query = parametros(segunda, filtros, qAdiado);
  useEffect(() => {
    let cancelado = false;
    api<RespostaLista<Tarefa>>(`/tarefas/?${query}`)
      .then((ts) => {
        if (!cancelado) {
          setTarefas(lista(ts));
          // setErro(null);
        }
      })
      .catch((e) => !cancelado && setErro(e instanceof ApiError ? e.message : "Erro ao carregar as tarefas."));
    return () => {
      cancelado = true;
    };
  }, [query, recarregar]);

  const dias = useMemo(() => diasDaJanela(new Date(`${segunda}T12:00:00`)), [segunda]);
  const visiveis = useMemo(
    () => (tarefas ?? []).filter((t) => filtros.concluidas || t.progresso < 100),
    [tarefas, filtros.concluidas],
  );
  const contagem = useMemo(() => {
    const c: Partial<Record<EstadoTarefa, number>> = {};
    for (const t of tarefas ?? []) c[t.estado] = (c[t.estado] ?? 0) + 1;
    return c;
  }, [tarefas]);

  const s1 = semanaIso(dias[0]);
  const s2 = semanaIso(dias[7]);
  const filtrosActivos = filtros.q || filtros.pessoa || filtros.seccao || filtros.estado || !filtros.concluidas;

  function mudarFiltro<K extends keyof Filtros>(k: K, v: Filtros[K]) {
    setFiltros((f) => ({ ...f, [k]: v }));
  }

  function escolherVista(v: Vista) {
    setVista(v);
    try {
      window.localStorage.setItem(CHAVE_VISTA, v);
    } catch {
      /* preferência não guardada: não faz mal */
    }
  }

  function moverSemana(n: number) {
    setSegunda((d) => iso(somarDias(new Date(`${d}T12:00:00`), 7 * n)));
  }

  const aoGuardar = useCallback(() => {
    setEmEdicao(undefined);
    setRecarregar((n) => n + 1);
  }, []);

  async function exportar() {
    setAExportar(true);
    try {
      const extra = filtros.concluidas ? "" : "&abertas=1";
      const { blob, nome } = await descarregar(`/tarefas/exportar/?${query}${extra}`, `Planeamento_SCADA_S${s1}.xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível exportar.");
    } finally {
      setAExportar(false);
    }
  }

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <div className={s.topo}>
          <div>
            <span className="eyebrow">Planeamento semanal de actividades</span>
            <h1>Semanas {s1} e {s2}</h1>
            <p className={s.periodo}>
              <b>S{s1}</b> {intervaloSemana(dias[0])} · <b>S{s2}</b> {intervaloSemana(dias[7])} {dias[13].getFullYear()}
            </p>
          </div>
          <div className={s.accoesTopo}>
            <div className={s.navSemana} role="group" aria-label="Mudar de semana">
              <button type="button" className="btn" onClick={() => moverSemana(-1)} aria-label="Semana anterior">‹</button>
                            <button type="button" className="btn" onClick={() => setSegunda(janelaActual)}
                      disabled={segunda === janelaActual}>Esta semana</button>
              <button type="button" className="btn" onClick={() => moverSemana(1)} aria-label="Semana seguinte">›</button>
            </div>
            <button type="button" className="btn" onClick={exportar} disabled={aExportar || !tarefas}>
              {aExportar ? "A exportar…" : "Exportar Excel"}
            </button>
            {podeEditar && (
              <button type="button" className={s.btnPrimario} onClick={() => setEmEdicao(null)} disabled={!seccoes.length} title={seccoes.length ? undefined : "À espera da lista de secções..."}>
                + Nova tarefa
              </button>
            )}
          </div>
        </div>

        <div className={s.resumo} aria-label="Resumo da janela">
          {(["em_curso", "planeada", "atrasada", "bloqueada", "sem_data", "concluida"] as EstadoTarefa[]).map((e) => (
            <button key={e} type="button" className={s.resumoItem} data-estado={e}
                    aria-pressed={filtros.estado === e}
                    onClick={() => mudarFiltro("estado", filtros.estado === e ? "" : e)}>
              <b>{contagem[e] ?? 0}</b> {ESTADOS[e]}
            </button>
          ))}
        </div>

        <div className={s.barra}>
          <div className={s.vistas} role="tablist" aria-label="Vista">
            <button type="button" role="tab" aria-selected={vista === "gantt"} onClick={() => escolherVista("gantt")}>
              Gantt
            </button>
            <button type="button" role="tab" aria-selected={vista === "pessoas"} onClick={() => escolherVista("pessoas")}>
              Por pessoa
            </button>
          </div>

          <input type="search" className={s.pesquisa} placeholder="Procurar localização ou actividade…"
                 value={filtros.q} onChange={(e) => mudarFiltro("q", e.target.value)} aria-label="Procurar" />
          <select value={filtros.pessoa} onChange={(e) => mudarFiltro("pessoa", e.target.value)} aria-label="Pessoa">
            <option value="">Toda a equipa</option>
            {pessoas.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <select value={filtros.seccao} onChange={(e) => mudarFiltro("seccao", e.target.value)} aria-label="Secção">
            <option value="">Todas as secções</option>
            {seccoes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
          <select value={filtros.estado} onChange={(e) => mudarFiltro("estado", e.target.value)} aria-label="Estado">
            <option value="">Todos os estados</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className={s.checkLinha}>
            <input type="checkbox" checked={filtros.concluidas}
                   onChange={(e) => mudarFiltro("concluidas", e.target.checked)} />
            Mostrar concluídas
          </label>
          {filtrosActivos && (
            <button type="button" className={s.limpar} onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>
          )}
        </div>

        {erro && <p className={s.erro} role="alert">{erro}</p>}

        <section className={s.quadro} aria-busy={tarefas === null}>
          {tarefas === null ? (
            <p className={s.vazio}>A carregar o planeamento…</p>
          ) : !visiveis.length ? (
            <p className={s.vazio}>
              Nenhuma tarefa nesta janela{filtrosActivos ? " com os filtros escolhidos" : ""}.
              {podeEditar && !filtrosActivos && " Use “+ Nova tarefa” para começar."}
            </p>
          ) : vista === "gantt" ? (
            <Gantt tarefas={visiveis} dias={dias} hoje={hoje} onAbrir={setEmEdicao} />
          ) : (
            <CalendarioPessoas tarefas={visiveis} pessoas={pessoas} dias={dias} hoje={hoje} onAbrir={setEmEdicao} />
          )}
        </section>

        <p className={s.nota}>
          {visiveis.length} {visiveis.length === 1 ? "tarefa" : "tarefas"} · todas as abertas e as concluídas que
          caem nestas duas semanas. A exportação usa os mesmos filtros.
        </p>

        {emEdicao !== undefined && (
          <DialogoTarefa
            key={emEdicao?.id ?? "nova"}
            tarefa={emEdicao}
            podeEditar={podeEditar}
            podeEliminar={podeEliminar}
            seccoes={seccoes}
            pessoas={pessoas}
            sitios={sitios}
            onFechar={() => setEmEdicao(undefined)}
            onGuardado={aoGuardar}
          />
        )}
      </main>
    </>
  );
}