"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import {
  DIAS_SEMANA, DIAS_SEMANA_CURTOS, TIPOS, diaCurto, diaLongo, horario, intervalo, iso, mover, nomeMes, ocupaDia,
  variosDias, type Evento, type ItemAgenda, type RespostaAgenda, type TipoItem, type Vista,
} from "@/lib/agenda";
import {
  ESTADOS, lista, semanaIso, type EstadoTarefa, type Pessoa, type RespostaLista, type Seccao, type SitioResumo,
  type Tarefa,
} from "@/lib/planeamento";
import DialogoTarefa from "../planeamento/DialogoTarefa";
import DialogoEvento from "./DialogoEvento";
import s from "./agenda.module.css";

const MAX_CELULA = 4;

function guardarPref(k: string, v: string) {
  try { localStorage.setItem(`sp_agenda_${k}`, v); } catch { /* sem armazenamento: ignora */ }
}
function lerPref(k: string): string | null {
  try { return localStorage.getItem(`sp_agenda_${k}`); } catch { return null; }
}

/** Uma linha da agenda (reunião, visita, prazo ou tarefa). */
function Item({ i, dia, compacto = false, onAbrir }: {
  i: ItemAgenda; dia?: string; compacto?: boolean; onAbrir: (i: ItemAgenda) => void;
}) {
  const marca = i.origem === "tarefa" && dia
    ? (dia === i.data ? "▶ " : dia === i.data_fim ? "■ " : "")
    : "";
  const quando = i.origem === "tarefa"
    ? `${diaCurto(i.data)} → ${diaCurto(i.data_fim)} · ${i.progresso ?? 0}%`
    : variosDias(i) ? `${diaCurto(i.data)} → ${diaCurto(i.data_fim)}` : horario(i);
  return (
    <button type="button" className={compacto ? s.chip : s.item} data-tipo={i.tipo} data-estado={i.estado}
            onClick={(e) => { e.stopPropagation(); onAbrir(i); }}
            title={`${TIPOS.find((t) => t.id === i.tipo)?.nome} · ${i.titulo} · ${quando}`}>
      {compacto ? (
        <>
          {i.hora_inicio && <b>{i.hora_inicio.slice(0, 5)}</b>}
          {marca}{i.titulo}
        </>
      ) : (
        <>
          <span className={s.quando}>{quando}</span>
          <span className={s.titulo}>{marca}{i.titulo}</span>
          <span className={s.detalhe}>
            {[TIPOS.find((t) => t.id === i.tipo)?.curto,
              i.local && i.local !== i.titulo.split(" — ")[0] ? i.local : null,
              i.origem === "tarefa" ? i.equipa_texto : [...i.pessoas, i.externos].filter(Boolean).join(", "),
              i.origem === "tarefa" ? ESTADOS[i.estado as EstadoTarefa] : i.estado !== "previsto" ? i.estado : null]
              .filter(Boolean).join(" · ")}
          </span>
        </>
      )}
    </button>
  );
}

export default function PaginaAgenda() {
  const { utilizador } = useAuth();
  const podeEditar = utilizador?.perfil === "admin" || utilizador?.perfil === "tecnico";
  const podeEliminar = utilizador?.perfil === "admin";
  const temPessoa = Boolean(utilizador?.tem_pessoa);

  const [vista, setVista] = useState<Vista>("mes");
  const [ref, setRef] = useState(() => new Date());
  const [minha, setMinha] = useState(false);
  const [pessoa, setPessoa] = useState("");
  const [tipos, setTipos] = useState<Set<TipoItem>>(() => new Set(TIPOS.map((t) => t.id)));
  const [dados, setDados] = useState<RespostaAgenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregar, setRecarregar] = useState(0);

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [sitios, setSitios] = useState<SitioResumo[]>([]);
  const [seccoes, setSeccoes] = useState<Seccao[]>([]);
  const [evento, setEvento] = useState<{ ev: Evento | null; data: string } | null>(null);
  const [tarefa, setTarefa] = useState<Tarefa | null>(null);

  // preferências do próprio navegador (vista e "a minha agenda")
  useEffect(() => {
    const v = lerPref("vista");
    if (v === "mes" || v === "semana" || v === "lista") setVista(v);
    if (lerPref("minha") === "1") setMinha(true);
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function carregar<T>(caminho: string, guardar: (v: T[]) => void) {
      try {
        const v = lista(await api<RespostaLista<T>>(caminho));
        if (!cancelado) guardar(v);
      } catch { /* os diálogos avisam se a lista faltar */ }
    }
    carregar<Pessoa>("/pessoas/", (v) => setPessoas([...v].sort((a, b) => a.nome.localeCompare(b.nome, "pt"))));
    carregar<SitioResumo>("/sitios/", setSitios);
    carregar<Seccao>("/seccoes/", (v) => setSeccoes([...v].sort((a, b) => a.ordem - b.ordem)));
    return () => { cancelado = true; };
  }, []);

  const { desde, ate, dias } = useMemo(() => intervalo(vista, ref), [vista, ref]);
  const hojeIso = iso(new Date());

  useEffect(() => {
    let cancelado = false;
    const q = new URLSearchParams({ desde: iso(desde), ate: iso(ate) });
    if (minha && temPessoa) q.set("minha", "1");
    else if (pessoa) q.set("pessoa", pessoa);
    api<RespostaAgenda>(`/agenda/?${q.toString()}`)
      .then((r) => { if (!cancelado) { setDados(r); setErro(null); } })
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : String(e)));
    return () => { cancelado = true; };
  }, [desde, ate, minha, pessoa, temPessoa, recarregar]);

  const itens = useMemo(() => (dados?.itens ?? []).filter((i) => tipos.has(i.tipo)), [dados, tipos]);
  const eventos = itens.filter((i) => i.origem === "evento");
  const tarefas = itens.filter((i) => i.origem === "tarefa");

  const recarregarDados = useCallback(() => setRecarregar((n) => n + 1), []);

  async function abrir(i: ItemAgenda) {
    try {
      if (i.origem === "evento") setEvento({ ev: await api<Evento>(`/eventos/${i.id}/`), data: i.data });
      else setTarefa(await api<Tarefa>(`/tarefas/${i.id}/`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  function novo(data: string) {
    if (podeEditar) setEvento({ ev: null, data });
  }

  function mudarVista(v: Vista) {
    setVista(v);
    guardarPref("vista", v);
  }

  function alternarTipo(t: TipoItem) {
    setTipos((ant) => {
      const n = new Set(ant);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n.size ? n : new Set(TIPOS.map((x) => x.id));
    });
  }

  const titulo = vista === "mes"
    ? nomeMes(ref)
    : vista === "semana"
      ? `Semana ${semanaIso(desde)} · ${diaCurto(iso(desde))} – ${diaCurto(iso(ate))}`
      : `${diaCurto(iso(desde))} – ${diaCurto(iso(ate))}`;

  // ---------- vista mês ----------
  function vistaMes() {
    return (
      <div className={s.mes} role="grid" aria-label={nomeMes(ref)}>
        {DIAS_SEMANA_CURTOS.map((d) => <div key={d} className={s.cabDia} role="columnheader">{d}</div>)}
        {dias.map((d) => {
          const di = iso(d);
          const evs = eventos.filter((i) => ocupaDia(i, di));
          // tarefas: mostra as que começam ou acabam no dia; as restantes contam como "em curso"
          const marcos = tarefas.filter((i) => i.data === di || i.data_fim === di);
          const emCurso = tarefas.filter((i) => ocupaDia(i, di)).length - marcos.length;
          const todos = [...evs, ...marcos];
          const fora = d.getMonth() !== ref.getMonth();
          return (
            <div key={di} role="gridcell" className={s.celula} data-fora={fora} data-hoje={di === hojeIso}
                 data-fds={d.getDay() === 0 || d.getDay() === 6}
                 onClick={() => novo(di)} aria-label={diaLongo(di)}>
              <span className={s.numDia}>{d.getDate()}</span>
              {todos.slice(0, MAX_CELULA).map((i) => (
                <Item key={i.chave} i={i} dia={di} compacto onAbrir={abrir} />
              ))}
              {todos.length > MAX_CELULA && (
                <button type="button" className={s.mais}
                        onClick={(e) => { e.stopPropagation(); setRef(d); mudarVista("lista"); }}>
                  +{todos.length - MAX_CELULA} mais
                </button>
              )}
              {emCurso > 0 && tipos.has("tarefa") && (
                <span className={s.emCurso}>{emCurso} {emCurso === 1 ? "tarefa" : "tarefas"} em curso</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- vista semana ----------
  function vistaSemana() {
    const d0 = iso(dias[0]);
    const d6 = iso(dias[6]);
    return (
      <div className={s.semana}>
        {dias.map((d, k) => (
          <div key={iso(d)} className={s.cabSemana} data-hoje={iso(d) === hojeIso} style={{ gridColumn: k + 1, gridRow: 1 }}>
            <span>{DIAS_SEMANA[k]}</span><b>{d.getDate()}</b>
          </div>
        ))}
        {tarefas.length > 0 && (
          <div className={s.faixaTarefas} style={{ gridColumn: "1 / -1", gridRow: 2 }}>
            {tarefas.map((i) => {
              const ini = i.data < d0 ? 0 : dias.findIndex((d) => iso(d) === i.data);
              const fim = i.data_fim > d6 ? 6 : dias.findIndex((d) => iso(d) === i.data_fim);
              return (
                <div key={i.chave} className={s.barraTarefa} style={{ gridColumn: `${ini + 1} / ${fim + 2}` }}
                     data-corta-ini={i.data < d0} data-corta-fim={i.data_fim > d6}>
                  <Item i={i} compacto onAbrir={abrir} />
                </div>
              );
            })}
          </div>
        )}
        {dias.map((d, k) => {
          const di = iso(d);
          const evs = eventos.filter((i) => ocupaDia(i, di));
          return (
            <div key={di} className={s.colunaDia} style={{ gridColumn: k + 1, gridRow: 3 }} data-hoje={di === hojeIso}
                 onClick={() => novo(di)}>
              {evs.map((i) => <Item key={i.chave} i={i} onAbrir={abrir} />)}
              {!evs.length && podeEditar && <span className={s.dicaVazia}>+ adicionar</span>}
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- vista lista (14 dias) ----------
  function vistaLista() {
    const comItens = dias.map((d) => {
      const di = iso(d);
      return {
        di,
        evs: eventos.filter((i) => ocupaDia(i, di)),
        tas: tarefas.filter((i) => i.data === di || i.data_fim === di || (di === iso(dias[0]) && i.data < di)),
      };
    }).filter((x) => x.evs.length || x.tas.length);
    if (!comItens.length) return <p className={s.vazio}>Nada na agenda para estes 14 dias.</p>;
    return (
      <ol className={s.lista}>
        {comItens.map(({ di, evs, tas }) => (
          <li key={di} data-hoje={di === hojeIso}>
            <h3>
              {di === hojeIso ? "Hoje · " : ""}{diaLongo(di)}
              {podeEditar && <button type="button" className={s.addDia} onClick={() => novo(di)} aria-label={`Adicionar a ${diaLongo(di)}`}>+</button>}
            </h3>
            <div className={s.itensDia}>
              {evs.map((i) => <Item key={i.chave} i={i} dia={di} onAbrir={abrir} />)}
              {tas.map((i) => <Item key={i.chave} i={i} dia={di} onAbrir={abrir} />)}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <div className={s.topo}>
          <div>
            <span className="eyebrow">Reuniões · visitas · prazos · tarefas</span>
            <h1>Agenda</h1>
          </div>
          {podeEditar && (
            <button type="button" className={s.btnNovo} onClick={() => novo(vista === "lista" ? iso(ref) : hojeIso)}>
              + Novo na agenda
            </button>
          )}
        </div>

        <div className={s.barra}>
          <div className={s.segmento} role="tablist" aria-label="Vista">
            {([["mes", "Mês"], ["semana", "Semana"], ["lista", "Lista"]] as [Vista, string][]).map(([v, n]) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => mudarVista(v)}>{n}</button>
            ))}
          </div>
          <div className={s.navegar}>
            <button type="button" className="btn" onClick={() => setRef(mover(vista, ref, -1))} aria-label="Anterior">‹</button>
            <button type="button" className="btn" onClick={() => setRef(new Date())}>Hoje</button>
            <button type="button" className="btn" onClick={() => setRef(mover(vista, ref, 1))} aria-label="Seguinte">›</button>
            <h2>{titulo}</h2>
          </div>
          <div className={s.filtros}>
            <label className={s.minha} title={temPessoa ? "" : "A sua conta não está associada a uma pessoa da equipa"}>
              <input type="checkbox" checked={minha && temPessoa} disabled={!temPessoa}
                     onChange={(e) => { setMinha(e.target.checked); guardarPref("minha", e.target.checked ? "1" : "0"); }} />
              Só a minha agenda
            </label>
            {!(minha && temPessoa) && (
              <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} aria-label="Pessoa">
                <option value="">Toda a equipa</option>
                {pessoas.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className={s.tipos} role="group" aria-label="Mostrar">
          {TIPOS.map((t) => (
            <button key={t.id} type="button" data-tipo={t.id} aria-pressed={tipos.has(t.id)} onClick={() => alternarTipo(t.id)}>
              <i aria-hidden="true" />{t.nome}
              <b>{(dados?.itens ?? []).filter((i) => i.tipo === t.id).length}</b>
            </button>
          ))}
        </div>

        {erro && <p className={s.erro} role="alert">{erro}</p>}
        {!dados && !erro && <p className={s.vazio}>A carregar a agenda…</p>}
        {dados && (vista === "mes" ? vistaMes() : vista === "semana" ? vistaSemana() : vistaLista())}

        <p className={s.nota}>
          As tarefas vêm do Planeamento (▶ início · ■ fim). {podeEditar
            ? "Clique num dia para acrescentar uma reunião, visita ou prazo."
            : "Perfil de leitura: pode consultar mas não alterar."}
        </p>

        {evento && (
          <DialogoEvento key={evento.ev?.id ?? `novo-${evento.data}`} evento={evento.ev} dataInicial={evento.data}
                         podeEditar={podeEditar} podeEliminar={podeEliminar} pessoas={pessoas} sitios={sitios}
                         minhaPessoa={temPessoa ? utilizador?.nome ?? null : null}
                         onFechar={() => setEvento(null)}
                         onGuardado={() => { setEvento(null); recarregarDados(); }} />
        )}
        {tarefa && (
          <DialogoTarefa key={tarefa.id} tarefa={tarefa} podeEditar={podeEditar} podeEliminar={podeEliminar}
                         seccoes={seccoes} pessoas={pessoas} sitios={sitios}
                         onFechar={() => setTarefa(null)}
                         onGuardado={() => { setTarefa(null); recarregarDados(); }} />
        )}
      </main>
    </>
  );
}
