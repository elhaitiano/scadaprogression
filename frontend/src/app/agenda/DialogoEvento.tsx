"use client";

import { useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "@/lib/api";
import {
  DIAS_SEMANA_CURTOS, ESTADOS_EVENTO, REPETICOES, TIPOS, diaCurto, diaLongo,
  type Conflito, type EstadoEvento, type Evento, type Repeticao, type TipoEvento,
} from "@/lib/agenda";
import { lista, nomeSitio, type Pessoa, type RespostaLista, type SitioResumo, type Tarefa } from "@/lib/planeamento";
import s from "../planeamento/planeamento.module.css";
import a from "./agenda.module.css";

type Erros = Record<string, string[]>;

interface Props {
  evento: Evento | null;       // null = novo
  dataInicial: string;         // novo: dia escolhido · existente: dia da ocorrência clicada
  horaInicial?: string;        // novo, a partir da grelha de horas da semana
  podeEditar: boolean;
  podeEliminar: boolean;
  pessoas: Pessoa[];
  sitios: SitioResumo[];
  minhaPessoa: string | null;  // nome da pessoa do utilizador, para a pré-seleccionar
  onFechar: () => void;
  onGuardado: () => void;
}

interface Form {
  tipo: TipoEvento;
  titulo: string;
  data: string;
  varios: boolean;
  data_fim: string;
  diaInteiro: boolean;
  hora_inicio: string;
  hora_fim: string;
  local: string;
  sitio: string;
  tarefa: string;
  participantes: number[];
  participantes_externos: string;
  descricao: string;
  estado: EstadoEvento;
  repeticao: Repeticao;
  intervalo: number;
  dias_semana: number[];
  repetir_ate: string;
}

function diaDaSemana(isoData: string): number {
  const [y, m, d] = isoData.split("-").map(Number);
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
}

function formDe(e: Evento | null, data: string, eu: number | undefined, hora = "09:00"): Form {
  const [hh, mm] = hora.split(":").map(Number);
  const fimPadrao = `${String(Math.min(23, hh + 1)).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return {
    tipo: e?.tipo ?? "reuniao",
    titulo: e?.titulo ?? "",
    data: e?.data ?? data,
    varios: Boolean(e?.data_fim),
    data_fim: e?.data_fim ?? "",
    diaInteiro: e ? !e.hora_inicio : false,
    hora_inicio: e?.hora_inicio?.slice(0, 5) ?? hora,
    hora_fim: e?.hora_fim?.slice(0, 5) ?? fimPadrao,
    local: e?.local ?? "",
    sitio: e?.sitio ? String(e.sitio) : "",
    tarefa: e?.tarefa ? String(e.tarefa) : "",
    participantes: e?.participantes ?? (eu ? [eu] : []),
    participantes_externos: e?.participantes_externos ?? "",
    descricao: e?.descricao ?? "",
    estado: e?.estado ?? "previsto",
    repeticao: e?.repeticao ?? "",
    intervalo: e?.intervalo ?? 1,
    dias_semana: e?.dias_semana ? e.dias_semana.split(",").map(Number) : [diaDaSemana(e?.data ?? data)],
    repetir_ate: e?.repetir_ate ?? "",
  };
}

function Erro({ erros, campo }: { erros: Erros; campo: string }) {
  return erros[campo]?.length ? <span className={s.erroCampo}>{erros[campo].join(" ")}</span> : null;
}

export default function DialogoEvento({
  evento, dataInicial, horaInicial, podeEditar, podeEliminar, pessoas, sitios, minhaPessoa, onFechar, onGuardado,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const eu = pessoas.find((p) => p.nome === minhaPessoa)?.id;
  const [form, setForm] = useState<Form>(() => formDe(evento, dataInicial, eu, horaInicial));
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [conflitos, setConflitos] = useState<{ lista: Conflito[]; total: number }>({ lista: [], total: 0 });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const so = !podeEditar;
  const prazo = form.tipo === "prazo";
  const comHoras = !prazo && !form.diaInteiro;
  const activos = pessoas.filter((p) => p.activo || form.participantes.includes(p.id));
  const visiveis = activos.filter((p) => p.nome.toLowerCase().includes(filtro.trim().toLowerCase()));

  // tarefas abertas para ligar (as do sítio escolhido, ou todas) + a já ligada
  useEffect(() => {
    let cancelado = false;
    const q = new URLSearchParams({ abertas: "1" });
    if (form.sitio) q.set("sitio", form.sitio);
    api<RespostaLista<Tarefa>>(`/tarefas/?${q.toString()}`)
      .then((r) => !cancelado && setTarefas(lista(r)))
      .catch(() => !cancelado && setTarefas([]));
    return () => { cancelado = true; };
  }, [form.sitio]);

  // aviso de conflitos: espera que o utilizador pare de escrever
  const chaveConflitos = useMemo(() => {
    if (prazo || form.estado === "cancelado" || !form.data || !form.participantes.length) return "";
    const q = new URLSearchParams({ data: form.data, tipo: form.tipo, participantes: form.participantes.join(",") });
    if (form.varios && form.data_fim) q.set("data_fim", form.data_fim);
    if (comHoras && form.hora_inicio) q.set("hora_inicio", form.hora_inicio);
    if (comHoras && form.hora_fim) q.set("hora_fim", form.hora_fim);
    if (form.repeticao && !form.varios) {
      q.set("repeticao", form.repeticao);
      q.set("intervalo", String(form.intervalo));
      q.set("dias_semana", form.dias_semana.join(","));
      if (form.repetir_ate) q.set("repetir_ate", form.repetir_ate);
    }
    if (evento) q.set("excluir", String(evento.id));
    return q.toString();
  }, [form, prazo, comHoras, evento]);

  useEffect(() => {
    if (!chaveConflitos) { setConflitos({ lista: [], total: 0 }); return; }
    let cancelado = false;
    const t = setTimeout(() => {
      api<{ conflitos: Conflito[]; total: number }>(`/eventos/conflitos/?${chaveConflitos}`)
        .then((r) => !cancelado && setConflitos({ lista: r.conflitos, total: r.total }))
        .catch(() => !cancelado && setConflitos({ lista: [], total: 0 }));
    }, 400);
    return () => { cancelado = true; clearTimeout(t); };
  }, [chaveConflitos]);

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
      tarefa: "",
      local: novo && (!f.local || (antigo && f.local === nomeSitio(antigo))) ? nomeSitio(novo) : f.local,
    }));
  }

  function escolherTarefa(id: string) {
    const t = tarefas.find((x) => String(x.id) === id);
    setForm((f) => ({
      ...f,
      tarefa: id,
      sitio: t?.sitio ? String(t.sitio) : f.sitio,
      titulo: f.titulo || (t ? t.descricao : ""),
      local: f.local || (t ? t.localizacao : ""),
      participantes: f.participantes.length > (eu ? 1 : 0) || !t ? f.participantes : [...new Set([...f.participantes, ...t.equipa])],
    }));
  }

  function alternar(id: number) {
    mudar("participantes", form.participantes.includes(id)
      ? form.participantes.filter((x) => x !== id) : [...form.participantes, id]);
  }

  function alternarDia(d: number) {
    const n = form.dias_semana.includes(d) ? form.dias_semana.filter((x) => x !== d) : [...form.dias_semana, d];
    mudar("dias_semana", n.length ? n.sort() : [d]);
  }

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (so) return;
    const locais: Erros = {};
    if (!form.titulo.trim()) locais.titulo = ["Indique o título."];
    if (!form.data) locais.data = ["Indique a data."];
    if (form.varios && form.data_fim && form.data_fim < form.data) locais.data_fim = ["A data de fim é anterior à data de início."];
    if (comHoras && form.hora_fim && form.hora_fim <= form.hora_inicio && !(form.varios && form.data_fim > form.data)) {
      locais.hora_fim = ["A hora de fim tem de ser depois da hora de início."];
    }
    if (form.repeticao && form.repetir_ate && form.repetir_ate < form.data) locais.repetir_ate = ["Antes do início."];
    setErros(locais);
    if (Object.keys(locais).length) return;

    const repete = form.repeticao && !form.varios;
    const corpo = {
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      data: form.data,
      data_fim: form.varios && form.data_fim ? form.data_fim : null,
      hora_inicio: comHoras ? form.hora_inicio || null : null,
      hora_fim: comHoras ? form.hora_fim || null : null,
      local: form.local.trim(),
      sitio: form.sitio ? Number(form.sitio) : null,
      tarefa: form.tarefa ? Number(form.tarefa) : null,
      participantes: form.participantes,
      participantes_externos: form.participantes_externos.trim(),
      descricao: form.descricao,
      estado: form.estado,
      repeticao: repete ? form.repeticao : "",
      intervalo: repete ? form.intervalo : 1,
      dias_semana: repete && form.repeticao === "semanal" ? form.dias_semana.join(",") : "",
      repetir_ate: repete && form.repetir_ate ? form.repetir_ate : null,
    };
    setAGuardar(true);
    try {
      await api(evento ? `/eventos/${evento.id}/` : "/eventos/", {
        method: evento ? "PATCH" : "POST",
        body: JSON.stringify(corpo),
      });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) setErros(Object.keys(err.campos).length ? err.campos : { non_field_errors: [err.message] });
    } finally {
      setAGuardar(false);
    }
  }

  async function retirarDia() {
    if (!evento) return;
    setAGuardar(true);
    try {
      await api(`/eventos/${evento.id}/excluir-ocorrencia/`, { method: "POST", body: JSON.stringify({ data: dataInicial }) });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) setErros({ non_field_errors: [err.message] });
    } finally {
      setAGuardar(false);
    }
  }

  async function eliminar() {
    if (!evento) return;
    setAGuardar(true);
    try {
      await api(`/eventos/${evento.id}/`, { method: "DELETE" });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) setErros({ non_field_errors: [err.message] });
    } finally {
      setAGuardar(false);
    }
  }

  const nomeTipo = TIPOS.find((t) => t.id === form.tipo)?.nome ?? "Evento";
  const serie = Boolean(evento?.repeticao);
  const tarefasOpcoes = evento?.tarefa && !tarefas.some((t) => t.id === evento.tarefa)
    ? [{ id: evento.tarefa, nome: evento.tarefa_nome ?? `Tarefa ${evento.tarefa}` }, ...tarefas.map((t) => ({ id: t.id, nome: `${t.localizacao} — ${t.descricao}` }))]
    : tarefas.map((t) => ({ id: t.id, nome: `${t.localizacao} — ${t.descricao}` }));

  return (
    <dialog ref={ref} className={s.dialogo} onClose={onFechar} aria-labelledby="dlg-evento">
      <form onSubmit={guardar} noValidate>
        <header className={s.dlgCab}>
          <div>
            <span className="eyebrow">{evento ? (so ? nomeTipo : `Editar · ${nomeTipo}`) : "Novo na agenda"}</span>
            <h2 id="dlg-evento">{evento ? evento.titulo : nomeTipo}</h2>
          </div>
          <button type="button" className={s.fechar} onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <fieldset className={s.dlgCorpo} disabled={so || aGuardar}>
          {serie && (
            <p className={a.avisoSerie}>
              ↻ Evento que se repete. As alterações aplicam-se a <b>todas</b> as ocorrências.
              {podeEditar && (
                <button type="button" className={a.linkBotao} onClick={retirarDia}>
                  Retirar só {diaLongo(dataInicial).toLowerCase()}
                </button>
              )}
            </p>
          )}

          <div className={s.grelha2}>
            <label className={s.campo}>
              Tipo
              <select value={form.tipo} onChange={(e) => mudar("tipo", e.target.value as TipoEvento)}>
                {TIPOS.filter((t) => t.id !== "tarefa").map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            {evento ? (
              <label className={s.campo}>
                Estado
                <select value={form.estado} onChange={(e) => mudar("estado", e.target.value as EstadoEvento)}>
                  {ESTADOS_EVENTO.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
            ) : <span />}
          </div>

          <label className={s.campo}>
            Título
            <input type="text" value={form.titulo} onChange={(e) => mudar("titulo", e.target.value)}
                   aria-invalid={Boolean(erros.titulo)}
                   placeholder={prazo ? "ex.: Entrega do auto de medição" : form.tipo === "visita"
                     ? "ex.: Verificação dos caudalímetros" : "ex.: Reunião de acompanhamento com a EPAL"} />
            <Erro erros={erros} campo="titulo" />
          </label>

          <div className={s.grelha4}>
            <label className={s.campo}>
              {form.varios ? "De" : serie || form.repeticao ? "Primeira data" : "Data"}
              <input type="date" value={form.data} onChange={(e) => mudar("data", e.target.value)}
                     aria-invalid={Boolean(erros.data)} />
              <Erro erros={erros} campo="data" />
            </label>
            {form.varios && (
              <label className={s.campo}>
                Até
                <input type="date" value={form.data_fim} min={form.data} onChange={(e) => mudar("data_fim", e.target.value)}
                       aria-invalid={Boolean(erros.data_fim)} />
                <Erro erros={erros} campo="data_fim" />
              </label>
            )}
            {comHoras && (
              <>
                <label className={s.campo}>
                  Início
                  <input type="time" value={form.hora_inicio} onChange={(e) => mudar("hora_inicio", e.target.value)} />
                  <Erro erros={erros} campo="hora_inicio" />
                </label>
                <label className={s.campo}>
                  Fim
                  <input type="time" value={form.hora_fim} onChange={(e) => mudar("hora_fim", e.target.value)}
                         aria-invalid={Boolean(erros.hora_fim)} />
                  <Erro erros={erros} campo="hora_fim" />
                </label>
              </>
            )}
          </div>
          <div className={a.opcoesLinha}>
            {!prazo && (
              <label className={s.checkLinha}>
                <input type="checkbox" checked={form.diaInteiro} onChange={(e) => mudar("diaInteiro", e.target.checked)} />
                Dia inteiro (sem hora)
              </label>
            )}
            <label className={s.checkLinha}>
              <input type="checkbox" checked={form.varios}
                     onChange={(e) => { mudar("varios", e.target.checked); if (e.target.checked) mudar("repeticao", ""); }} />
              Vários dias
            </label>
            {!form.varios && (
              <label className={a.repeticao}>
                Repetição
                <select value={form.repeticao} onChange={(e) => {
                  mudar("repeticao", e.target.value as Repeticao);
                  if (e.target.value === "semanal" && !evento?.dias_semana) mudar("dias_semana", [diaDaSemana(form.data)]);
                }}>
                  {REPETICOES.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </label>
            )}
          </div>

          {form.repeticao && !form.varios && (
            <div className={a.blocoRepeticao}>
              {form.repeticao !== "diaria" && (
                <label className={a.repeticao}>
                  A cada
                  <input type="number" min={1} max={12} value={form.intervalo}
                         onChange={(e) => mudar("intervalo", Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
                  {form.repeticao === "semanal" ? (form.intervalo === 1 ? "semana" : "semanas") : (form.intervalo === 1 ? "mês" : "meses")}
                </label>
              )}
              {form.repeticao === "semanal" && (
                <div className={a.diasSemana} role="group" aria-label="Dias da semana">
                  {DIAS_SEMANA_CURTOS.map((d, k) => (
                    <button key={d} type="button" aria-pressed={form.dias_semana.includes(k)} onClick={() => alternarDia(k)}>{d}</button>
                  ))}
                </div>
              )}
              <label className={a.repeticao}>
                Até
                <input type="date" value={form.repetir_ate} min={form.data} onChange={(e) => mudar("repetir_ate", e.target.value)} />
                {!form.repetir_ate && <small>sem fim</small>}
              </label>
              <Erro erros={erros} campo="repetir_ate" />
              <Erro erros={erros} campo="repeticao" />
              {evento && evento.excepcoes.length > 0 && (
                <small className={a.excepcoes}>Dias retirados: {evento.excepcoes.map(diaCurto).join(", ")}</small>
              )}
            </div>
          )}

          <div className={s.grelha2}>
            <label className={s.campo}>
              Sítio (opcional)
              <select value={form.sitio} onChange={(e) => escolherSitio(e.target.value)}>
                <option value="">— Nenhum —</option>
                {sitios.map((x) => <option key={x.id} value={x.id}>{nomeSitio(x)}</option>)}
              </select>
            </label>
            <label className={s.campo}>
              Local
              <input type="text" value={form.local} onChange={(e) => mudar("local", e.target.value)}
                     placeholder="ex.: EPAL sede, CD Marçal, Teams" />
            </label>
          </div>

          <label className={s.campo}>
            Tarefa do planeamento (opcional)
            <select value={form.tarefa} onChange={(e) => escolherTarefa(e.target.value)}>
              <option value="">— Nenhuma —</option>
              {tarefasOpcoes.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <span className={s.dica}>
              {form.sitio ? "Tarefas abertas deste sítio." : "Tarefas abertas. Escolha um sítio para ver só as dele."}
            </span>
            <Erro erros={erros} campo="tarefa" />
          </label>

          <div className={s.campo}>
            <span className={s.rotuloLinha}>
              {prazo ? "Responsáveis" : "Participantes"} <small>{form.participantes.length} seleccionado(s)</small>
              {!so && (
                <input type="search" className={s.filtroEquipa} placeholder="Filtrar nomes…" value={filtro}
                       onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar participantes" />
              )}
            </span>
            <div className={s.equipa} role="group" aria-label="Participantes">
              {visiveis.map((p) => (
                <label key={p.id} className={s.pessoa} data-activo={form.participantes.includes(p.id)}>
                  <input type="checkbox" checked={form.participantes.includes(p.id)} onChange={() => alternar(p.id)} />
                  {p.nome}
                </label>
              ))}
              {!pessoas.length && <span className={s.dica}>A lista de pessoas não carregou.</span>}
            </div>
          </div>

          {conflitos.total > 0 && (
            <div className={a.avisoConflito} role="status">
              <b>⚠ {conflitos.total === 1 ? "Uma pessoa já está ocupada" : `${conflitos.total} sobreposições`}</b>
              <ul>
                {conflitos.lista.map((c, k) => (
                  <li key={k}>
                    {c.pessoa} · {c.data ? `${diaCurto(c.data)} · ` : ""}{c.com} ({c.horario})
                  </li>
                ))}
              </ul>
              {conflitos.total > conflitos.lista.length && <small>… e mais {conflitos.total - conflitos.lista.length}.</small>}
              <small>É só um aviso: pode gravar na mesma.</small>
            </div>
          )}

          <label className={s.campo}>
            {prazo ? "Entidade" : "Participantes externos"} (opcional)
            <input type="text" value={form.participantes_externos}
                   onChange={(e) => mudar("participantes_externos", e.target.value)}
                   placeholder="ex.: EPAL (Eng.ª …), SUEZ Digital Solutions" />
          </label>

          <label className={s.campo}>
            {form.tipo === "reuniao" ? "Ordem de trabalhos / notas" : "Descrição / notas"}
            <textarea rows={3} value={form.descricao} onChange={(e) => mudar("descricao", e.target.value)} />
          </label>

          {erros.non_field_errors && <p className={s.erro} role="alert">{erros.non_field_errors.join(" ")}</p>}

          {evento && (
            <p className={s.rasto}>
              {evento.criado_por_nome && `Criado por ${evento.criado_por_nome}`}
              {evento.actualizado_por_nome && ` · actualizado por ${evento.actualizado_por_nome}`}
            </p>
          )}
        </fieldset>

        <footer className={s.dlgRodape}>
          {evento && podeEliminar && (
            <div className={s.eliminar}>
              {confirmarEliminar ? (
                <>
                  <span>{serie ? "Eliminar a série inteira?" : "Eliminar definitivamente?"}</span>
                  <button type="button" className={s.btnPerigo} onClick={eliminar} disabled={aGuardar}>Sim, eliminar</button>
                  <button type="button" className="btn" onClick={() => setConfirmarEliminar(false)}>Não</button>
                </>
              ) : (
                <button type="button" className={s.btnPerigoLeve} onClick={() => setConfirmarEliminar(true)}>
                  {serie ? "Eliminar série" : "Eliminar"}
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn" onClick={onFechar}>{so ? "Fechar" : "Cancelar"}</button>
          {!so && (
            <button type="submit" className={s.btnPrimario} disabled={aGuardar}>
              {aGuardar ? "A guardar…" : evento ? "Guardar alterações" : "Adicionar à agenda"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
