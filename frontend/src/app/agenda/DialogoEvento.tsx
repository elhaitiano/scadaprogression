"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { ESTADOS_EVENTO, TIPOS, type EstadoEvento, type Evento, type TipoEvento } from "@/lib/agenda";
import { nomeSitio, type Pessoa, type SitioResumo } from "@/lib/planeamento";
import s from "../planeamento/planeamento.module.css";

type Erros = Record<string, string[]>;

interface Props {
  evento: Evento | null;     // null = novo
  dataInicial: string;       // para um evento novo
  podeEditar: boolean;
  podeEliminar: boolean;
  pessoas: Pessoa[];
  sitios: SitioResumo[];
  minhaPessoa: string | null; // nome da pessoa do utilizador, para a pré-seleccionar
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
  participantes: number[];
  participantes_externos: string;
  descricao: string;
  estado: EstadoEvento;
}

function formDe(e: Evento | null, data: string, eu: number | undefined): Form {
  return {
    tipo: e?.tipo ?? "reuniao",
    titulo: e?.titulo ?? "",
    data: e?.data ?? data,
    varios: Boolean(e?.data_fim),
    data_fim: e?.data_fim ?? "",
    diaInteiro: e ? !e.hora_inicio : false,
    hora_inicio: e?.hora_inicio?.slice(0, 5) ?? "09:00",
    hora_fim: e?.hora_fim?.slice(0, 5) ?? "10:00",
    local: e?.local ?? "",
    sitio: e?.sitio ? String(e.sitio) : "",
    participantes: e?.participantes ?? (eu ? [eu] : []),
    participantes_externos: e?.participantes_externos ?? "",
    descricao: e?.descricao ?? "",
    estado: e?.estado ?? "previsto",
  };
}

function Erro({ erros, campo }: { erros: Erros; campo: string }) {
  return erros[campo]?.length ? <span className={s.erroCampo}>{erros[campo].join(" ")}</span> : null;
}

export default function DialogoEvento({
  evento, dataInicial, podeEditar, podeEliminar, pessoas, sitios, minhaPessoa, onFechar, onGuardado,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const eu = pessoas.find((p) => p.nome === minhaPessoa)?.id;
  const [form, setForm] = useState<Form>(() => formDe(evento, dataInicial, eu));
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const so = !podeEditar;
  const prazo = form.tipo === "prazo";
  const activos = pessoas.filter((p) => p.activo || form.participantes.includes(p.id));
  const visiveis = activos.filter((p) => p.nome.toLowerCase().includes(filtro.trim().toLowerCase()));

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
      local: novo && (!f.local || (antigo && f.local === nomeSitio(antigo))) ? nomeSitio(novo) : f.local,
    }));
  }

  function alternar(id: number) {
    mudar("participantes", form.participantes.includes(id)
      ? form.participantes.filter((x) => x !== id) : [...form.participantes, id]);
  }

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (so) return;
    const locais: Erros = {};
    if (!form.titulo.trim()) locais.titulo = ["Indique o título."];
    if (!form.data) locais.data = ["Indique a data."];
    if (form.varios && form.data_fim && form.data_fim < form.data) locais.data_fim = ["A data de fim é anterior à data de início."];
    const comHoras = !prazo && !form.diaInteiro;
    if (comHoras && form.hora_fim && form.hora_fim <= form.hora_inicio && !(form.varios && form.data_fim > form.data)) {
      locais.hora_fim = ["A hora de fim tem de ser depois da hora de início."];
    }
    setErros(locais);
    if (Object.keys(locais).length) return;

    const corpo = {
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      data: form.data,
      data_fim: form.varios && form.data_fim ? form.data_fim : null,
      hora_inicio: comHoras ? form.hora_inicio || null : null,
      hora_fim: comHoras ? form.hora_fim || null : null,
      local: form.local.trim(),
      sitio: form.sitio ? Number(form.sitio) : null,
      participantes: form.participantes,
      participantes_externos: form.participantes_externos.trim(),
      descricao: form.descricao,
      estado: form.estado,
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
              {form.varios ? "De" : "Data"}
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
            {!prazo && !form.diaInteiro && (
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
          <div className={s.grelha2}>
            {!prazo && (
              <label className={s.checkLinha}>
                <input type="checkbox" checked={form.diaInteiro} onChange={(e) => mudar("diaInteiro", e.target.checked)} />
                Dia inteiro (sem hora)
              </label>
            )}
            <label className={s.checkLinha}>
              <input type="checkbox" checked={form.varios} onChange={(e) => mudar("varios", e.target.checked)} />
              Vários dias
            </label>
          </div>

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
              {aGuardar ? "A guardar…" : evento ? "Guardar alterações" : "Adicionar à agenda"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
