"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import {
  DIAS_SEMANA, DIAS_SEMANA_CURTOS, TIPOS, diaCurto, diaLongo, horario, intervalo, iso, mover, nomeMes, ocupaDia,
  minutos, variosDias, type Evento, type ItemAgenda, type RespostaAgenda, type TipoItem, type Vista,
} from "@/lib/agenda";
import {
  ESTADOS, lista, semanaIso, type EstadoTarefa, type Pessoa, type RespostaLista, type Seccao, type SitioResumo,
  type Tarefa,
} from "@/lib/planeamento";
import DialogoTarefa from "../planeamento/DialogoTarefa";
import DialogoEvento from "./DialogoEvento";
import s from "./agenda.module.css";

const MAX_CELULA = 4;
const PX_HORA = 48;

function guardarPref(k: string, v: string) {
  try { localStorage.setItem(`sp_agenda_${k}`, v); } catch { /* sem armazenamento: ignora */ }
}
function lerPref(k: string): string | null {
  try { return localStorage.getItem(`sp_agenda_${k}`); } catch { return null; }
}

/** Uma linha da agenda (reunião, visita, prazo ou tarefa). */
function Item({ i, dia, compacto = false, onAbrir, estilo }: {
  i: ItemAgenda; dia?: string; compacto?: boolean; onAbrir: (i: ItemAgenda) => void; estilo?: React.CSSProperties;
}) {
  const marca = i.origem === "tarefa" && dia
    ? (dia === i.data ? "▶ " : dia === i.data_fim ? "■ " : "")
    : "";
  const quando = i.origem === "tarefa"
    ? `${diaCurto(i.data)} → ${diaCurto(i.data_fim)} · ${i.progresso ?? 0}%`
    : variosDias(i) ? `${diaCurto(i.data)} → ${diaCurto(i.data_fim)}` : horario(i);
  const conflito = i.conflitos.length
    ? `Sobreposição: ${i.conflitos.map((c) => `${c.pessoa} também em "${c.com}" (${c.horario})`).join("; ")}`
    : "";
  const icones = <>{i.conflitos.length > 0 && <span className={s.alerta} aria-label="Sobreposição">⚠</span>}{i.serie && <span className={s.serie} aria-label="Repete-se">↻</span>}</>;
  return (
    <button type="button" className={compacto ? s.chip : s.item} data-tipo={i.tipo} data-estado={i.estado}
            data-conflito={i.conflitos.length > 0} style={estilo}
            onClick={(e) => { e.stopPropagation(); onAbrir(i); }}
            title={[`${TIPOS.find((t) => t.id === i.tipo)?.nome} · ${i.titulo} · ${quando}`, conflito].filter(Boolean).join("\n")}>
      {compacto ? (
        <>
          {icones}
          {i.hora_inicio && <b>{i.hora_inicio.slice(0, 5)}</b>}
          {marca}{i.titulo}
        </>
      ) : (
        <>
          <span className={s.quando}>{icones}{quando}</span>
          <span className={s.titulo}>{marca}{i.titulo}</span>
          <span className={s.detalhe}>
            {[TIPOS.find((t) => t.id === i.tipo)?.curto,
              i.local && i.local !== i.titulo.split(" — ")[0] ? i.local : null,
              i.origem === "tarefa" ? i.equipa_texto : [...i.pessoas, i.externos].filter(Boolean).join(", "),
              i.origem === "tarefa" ? ESTADOS[i.estado as EstadoTarefa] : i.estado !== "previsto" ? i.estado : null]
              .filter(Boolean).join(" · ")}
          </span>
          {i.tarefa_nome && <span className={s.detalhe}>Tarefa: {i.tarefa_nome}</span>}
          {conflito && <span className={s.textoConflito}>{conflito}</span>}
        </>
      )}
    </button>
  );
}

/** Distribui eventos que se sobrepõem por colunas lado a lado (como no Outlook). */
function colunas(evs: ItemAgenda[]): Map<string, { col: number; de: number }> {
  const r = new Map<string, { col: number; de: number }>();
  const fimDe = (i: ItemAgenda) => (i.hora_fim ? minutos(i.hora_fim) : minutos(i.hora_inicio) + 60);
  const ord = [...evs].sort((x, y) => minutos(x.hora_inicio) - minutos(y.hora_inicio) || fimDe(y) - fimDe(x));
  let grupo: { i: ItemAgenda; col: number }[] = [];
  let fimCols: number[] = [];       // fim do último evento em cada coluna do grupo
  let fimGrupo = -1;
  const fechar = () => {
    grupo.forEach((g) => r.set(g.i.chave, { col: g.col, de: fimCols.length }));
    grupo = [];
    fimCols = [];
  };
  for (const i of ord) {
    const ini = minutos(i.hora_inicio);
    if (ini >= fimGrupo) fechar();
    let col = fimCols.findIndex((f) => f <= ini);
    if (col < 0) { col = fimCols.length; fimCols.push(0); }
    fimCols[col] = fimDe(i);
    grupo.push({ i, col });
    fimGrupo = Math.max(fimGrupo, fimDe(i));
  }
  fechar();
  return r;
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
  const [evento, setEvento] = useState<{ ev: Evento | null; data: string; hora?: string } | null>(null);
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

  // ---------- vista semana (com horas) ----------
  function vistaSemana() {
    const d0 = iso(dias[0]);
    const d6 = iso(dias[6]);
    const comHora = eventos.filter((i) => i.hora_inicio && !variosDias(i));
    const semHora = eventos.filter((i) => !i.hora_inicio || variosDias(i));
    // 07h–19h por omissão, alargado se houver eventos fora disso
    const h0 = Math.min(7, ...comHora.map((i) => Math.floor(minutos(i.hora_inicio) / 60)));
    const h1 = Math.max(19, ...comHora.map((i) => Math.ceil((i.hora_fim ? minutos(i.hora_fim) : minutos(i.hora_inicio) + 60) / 60)));
    const horas = Array.from({ length: h1 - h0 }, (_, k) => h0 + k);
    const agora = new Date();
    const minAgora = agora.getHours() * 60 + agora.getMinutes();
    return (
      <>
        <div className={s.semana}>
          <div className={s.canto} style={{ gridColumn: 1, gridRow: 1 }} />
          {dias.map((d, k) => (
            <div key={iso(d)} className={s.cabSemana} data-hoje={iso(d) === hojeIso} style={{ gridColumn: k + 2, gridRow: 1 }}>
              <span>{DIAS_SEMANA[k]}</span><b>{d.getDate()}</b>
            </div>
          ))}

          <div className={s.rotuloFaixa} style={{ gridColumn: 1, gridRow: 2 }}>Dia inteiro</div>
          {dias.map((d, k) => {
            const di = iso(d);
            const lst = semHora.filter((i) => ocupaDia(i, di));
            return (
              <div key={di} className={s.diaInteiro} style={{ gridColumn: k + 2, gridRow: 2 }} data-hoje={di === hojeIso}
                   onClick={() => novo(di)}>
                {lst.map((i) => <Item key={i.chave} i={i} compacto onAbrir={abrir} />)}
              </div>
            );
          })}

          {tarefas.length > 0 && (
            <>
              <div className={s.rotuloFaixa} style={{ gridColumn: 1, gridRow: 3 }}>Tarefas</div>
              <div className={s.faixaTarefas} style={{ gridColumn: "2 / -1", gridRow: 3 }}>
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
            </>
          )}

          <div className={s.horas} style={{ gridColumn: 1, gridRow: 4, height: horas.length * PX_HORA }}>
            {horas.map((h) => <span key={h} style={{ top: (h - h0) * PX_HORA }}>{String(h).padStart(2, "0")}:00</span>)}
          </div>
          {dias.map((d, k) => {
            const di = iso(d);
            const evs = comHora.filter((i) => i.data === di);
            const pos = colunas(evs);
            return (
              <div key={di} className={s.colunaHoras} style={{ gridColumn: k + 2, gridRow: 4, height: horas.length * PX_HORA }}
                   data-hoje={di === hojeIso}
                   onClick={(e) => {
                     if (!podeEditar) return;
                     const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
                     const h = Math.min(h1 - 1, Math.max(h0, h0 + Math.floor(y / PX_HORA)));
                     setEvento({ ev: null, data: di, hora: `${String(h).padStart(2, "0")}:00` });
                   }}>
                {horas.map((h) => <i key={h} className={s.linhaHora} style={{ top: (h - h0) * PX_HORA }} />)}
                {di === hojeIso && minAgora >= h0 * 60 && minAgora < h1 * 60 && (
                  <i className={s.agora} style={{ top: (minAgora - h0 * 60) * PX_HORA / 60 }} aria-hidden="true" />
                )}
                {evs.map((i) => {
                  const ini = minutos(i.hora_inicio);
                  const fim = i.hora_fim ? minutos(i.hora_fim) : ini + 60;
                  const p = pos.get(i.chave) ?? { col: 0, de: 1 };
                  return (
                    <Item key={i.chave} i={i} onAbrir={abrir} compacto={fim - ini < 45}
                          estilo={{
                            position: "absolute",
                            top: (ini - h0 * 60) * PX_HORA / 60,
                            height: Math.max(20, (fim - ini) * PX_HORA / 60 - 2),
                            left: `calc(${(100 / p.de) * p.col}% + 2px)`,
                            width: `calc(${100 / p.de}% - 4px)`,
                          }} />
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* telemóvel: a mesma semana em lista */}
        <ol className={`${s.lista} ${s.semanaMovel}`}>
          {dias.map((d) => {
            const di = iso(d);
            const lst = [...eventos.filter((i) => ocupaDia(i, di)), ...tarefas.filter((i) => i.data === di || i.data_fim === di)];
            return (
              <li key={di} data-hoje={di === hojeIso}>
                <h3>{diaLongo(di)}
                  {podeEditar && <button type="button" className={s.addDia} onClick={() => novo(di)} aria-label={`Adicionar a ${diaLongo(di)}`}>+</button>}
                </h3>
                <div className={s.itensDia}>
                  {lst.length ? lst.map((i) => <Item key={i.chave} i={i} dia={di} onAbrir={abrir} />)
                    : <span className={s.dicaVazia}>—</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </>
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
          <DialogoEvento key={evento.ev?.id ?? `novo-${evento.data}-${evento.hora ?? ""}`} evento={evento.ev} dataInicial={evento.data}
                         horaInicial={evento.hora}
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
