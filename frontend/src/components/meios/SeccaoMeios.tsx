"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  TIPOS_MEIO, descricaoMeio, type Alocacao, type MeioDisponivel, type PedidoMeio, type TipoCatalogo, type TipoMeio,
} from "@/lib/meios";
import s from "./meios.module.css";

interface Props {
  alvo: { tipo: "tarefa" | "evento"; id: number };
  inicio: string;                    // período do alvo (já gravado)
  fim: string;
  horaInicio?: string | null;
  horaFim?: string | null;
  dataFixa?: string;                 // evento que se repete: a afectação é só para esta ocorrência
  equipa: { id: number; nome: string }[];
  podeEditar: boolean;
}

function erroTexto(e: unknown): string {
  if (e instanceof ApiError) {
    const campos = Object.values(e.campos ?? {}).flat();
    return campos.length ? campos.join(" ") : e.message;
  }
  return "Não foi possível concluir.";
}

/** Meios afectados a uma tarefa ou a um evento, com escolha entre os disponíveis e pedido externo. */
export default function SeccaoMeios({ alvo, inicio, fim, horaInicio, horaFim, dataFixa, equipa, podeEditar }: Props) {
  const [alocacoes, setAlocacoes] = useState<Alocacao[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoMeio[]>([]);
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoMeio>("viatura");
  const [tipos, setTipos] = useState<TipoCatalogo[]>([]);
  const [tipoMeio, setTipoMeio] = useState("");      // "" = qualquer tipo da categoria
  const [capMin, setCapMin] = useState("");
  const [ini, setIni] = useState(dataFixa ?? inicio);
  const [fi, setFi] = useState(dataFixa ?? fim);
  const [comHoras, setComHoras] = useState(Boolean(horaInicio) && (dataFixa ? true : inicio === fim));
  const [hi, setHi] = useState(horaInicio?.slice(0, 5) ?? "08:00");
  const [hf, setHf] = useState(horaFim?.slice(0, 5) ?? "12:00");
  const [pessoa, setPessoa] = useState("");
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [disp, setDisp] = useState<MeioDisponivel[] | null>(null);
  const [pedir, setPedir] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [po, setPo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  const filtro = `${alvo.tipo}=${alvo.id}`;
  const tipoEscolhido = tipos.find((x) => String(x.id) === tipoMeio);
  const unidade = tipoEscolhido?.unidade ?? "";
  const capNum = unidade && capMin.trim() ? Number(capMin.replace(",", ".")) : null;
  const umDia = ini === fi;

  const carregar = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        api<Alocacao[]>(`/alocacoes/?${filtro}`),
        api<PedidoMeio[]>(`/pedidos-meios/?${filtro}&abertos=1`),
      ]);
      setAlocacoes(a);
      setPedidos(p);
    } catch (e) {
      setErro(erroTexto(e));
    }
  }, [filtro]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!aberto || tipos.length) return;
    api<TipoCatalogo[]>("/tipos-meios/?activos=1").then(setTipos).catch(() => setTipos([]));
  }, [aberto, tipos.length]);

  // meios do tipo escolhido, com disponibilidade no período escolhido
  useEffect(() => {
    if (!aberto || !ini || !fi || fi < ini) return;
    let cancelado = false;
    const q = new URLSearchParams({ desde: ini, ate: fi, tipo });
    if (tipoMeio) q.set("tipo_meio", tipoMeio);
    if (capNum && capNum > 0) q.set("capacidade_min", String(capNum));
    if (umDia && comHoras) {
      q.set("hora_inicio", hi);
      q.set("hora_fim", hf);
    }
    const t = setTimeout(() => {
      api<{ meios: MeioDisponivel[] }>(`/meios/disponibilidade/?${q.toString()}`)
        .then((r) => {
          if (cancelado) return;
          setDisp(r.meios);
          setEscolhido((x) => (r.meios.some((m) => m.id === x && m.disponivel) ? x : null));
        })
        .catch(() => !cancelado && setDisp([]));
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [aberto, tipo, tipoMeio, capNum, ini, fi, umDia, comHoras, hi, hf]);

  function abrir() {
    setAberto(true);
    setPedir(false);
    setErro(null);
    setDescricao("");
  }

  async function afectar() {
    if (!escolhido) return;
    setAGravar(true);
    setErro(null);
    try {
      await api("/alocacoes/", {
        method: "POST",
        body: JSON.stringify({
          meio: escolhido,
          [alvo.tipo]: alvo.id,
          pessoa: pessoa ? Number(pessoa) : null,
          data_inicio: ini,
          data_fim: fi,
          hora_inicio: umDia && comHoras ? hi : null,
          hora_fim: umDia && comHoras ? hf : null,
        }),
      });
      setAberto(false);
      setEscolhido(null);
      await carregar();
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setAGravar(false);
    }
  }

  async function registarPedido() {
    setAGravar(true);
    setErro(null);
    try {
      await api("/pedidos-meios/", {
        method: "POST",
        body: JSON.stringify({
          tipo,
          tipo_meio: tipoMeio ? Number(tipoMeio) : null,
          capacidade_minima: capNum && capNum > 0 ? capNum : null,
          descricao: descricao.trim() || descricaoPadrao,
          data_inicio: ini,
          data_fim: fi,
          [alvo.tipo]: alvo.id,
          pessoa: pessoa ? Number(pessoa) : null,
          po_referencia: po.trim(),
          fornecedor: fornecedor.trim(),
        }),
      });
      setAberto(false);
      setPedir(false);
      setPo("");
      setFornecedor("");
      await carregar();
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setAGravar(false);
    }
  }

  async function retirar(a: Alocacao) {
    setErro(null);
    try {
      await api(`/alocacoes/${a.id}/`, { method: "DELETE" });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 403
        ? "Só o Administrador ou quem fez a afectação a pode retirar."
        : erroTexto(e));
    }
  }

  const livres = (disp ?? []).filter((m) => m.disponivel);
  const descricaoPadrao = [tipoEscolhido?.nome ?? TIPOS_MEIO.find((x) => x.id === tipo)?.nome,
    capNum && capNum > 0 ? `≥ ${String(capNum).replace(".", ",")} ${unidade}` : ""].filter(Boolean).join(" ");
  const nomeTipo = TIPOS_MEIO.find((t) => t.id === tipo)?.nome.toLowerCase();

  return (
    // Enter num campo daqui não deve gravar o formulário da tarefa/evento
    <section className={s.seccao} aria-labelledby={`meios-${alvo.tipo}-${alvo.id}`}
             onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <header>
        <h3 id={`meios-${alvo.tipo}-${alvo.id}`}>Meios <small>{alocacoes?.length ?? 0} afectado(s)</small></h3>
        {podeEditar && !aberto && (
          <button type="button" className={s.btnLinha} onClick={abrir}>+ Afectar meio</button>
        )}
      </header>

      {alocacoes && alocacoes.length > 0 && (
        <ul className={s.lista}>
          {alocacoes.map((a) => (
            <li key={a.id}>
              <span className={s.tipoMeio} data-tipo={a.meio_tipo}>{TIPOS_MEIO.find((t) => t.id === a.meio_tipo)?.nome.split(" ")[0]}</span>
              <b>{a.meio_nome}</b>
              <span>{a.periodo}{a.pessoa_nome ? ` · ${a.pessoa_nome}` : ""}</span>
              {podeEditar && (
                <button type="button" className={s.retirar} onClick={() => retirar(a)} aria-label={`Retirar ${a.meio_nome}`}>
                  Retirar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {alocacoes && !alocacoes.length && !aberto && !pedidos.length && (
        <p className={s.vazio}>Nenhum meio afectado.</p>
      )}

      {pedidos.length > 0 && (
        <ul className={s.lista}>
          {pedidos.map((p) => (
            <li key={p.id} data-pedido="true">
              <span className={s.estadoPedido} data-estado={p.estado}>{p.estado_nome}</span>
              <b>{p.descricao}</b>
              <span>{p.po_referencia ? `PO ${p.po_referencia}` : "sem PO"} · <Link href="/meios?aba=pedidos">ver pedido</Link></span>
            </li>
          ))}
        </ul>
      )}

      {aberto && (
        <div className={s.form}>
          <div className={s.segmento} role="group" aria-label="Tipo de meio">
            {TIPOS_MEIO.map((t) => (
              <button key={t.id} type="button" aria-pressed={tipo === t.id}
                      onClick={() => { setTipo(t.id); setTipoMeio(""); setCapMin(""); }}>{t.nome}</button>
            ))}
          </div>

          <div className={s.linha}>
            <label>Tipo
              <select value={tipoMeio} onChange={(e) => { setTipoMeio(e.target.value); setCapMin(""); }}>
                <option value="">Qualquer</option>
                {tipos.filter((x) => x.categoria === tipo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
            </label>
            {unidade && (
              <label>Capacidade mínima
                <input type="text" inputMode="decimal" size={6} value={capMin} onChange={(e) => setCapMin(e.target.value)}
                       placeholder={unidade} /> {unidade}
              </label>
            )}
          </div>

          <div className={s.linha}>
            {dataFixa ? (
              <span className={s.fixo}>Dia {new Date(`${dataFixa}T12:00:00`).toLocaleDateString("pt-PT")} (esta ocorrência)</span>
            ) : (
              <>
                <label>De <input type="date" value={ini} min={inicio} max={fim} onChange={(e) => setIni(e.target.value)} /></label>
                <label>Até <input type="date" value={fi} min={ini} max={fim} onChange={(e) => setFi(e.target.value)} /></label>
              </>
            )}
            {umDia && (
              <label className={s.check}>
                <input type="checkbox" checked={comHoras} onChange={(e) => setComHoras(e.target.checked)} /> Só algumas horas
              </label>
            )}
            {umDia && comHoras && (
              <>
                <label>das <input type="time" value={hi} onChange={(e) => setHi(e.target.value)} /></label>
                <label>às <input type="time" value={hf} onChange={(e) => setHf(e.target.value)} /></label>
              </>
            )}
          </div>

          <label className={s.linha}>
            Quem vai usar
            <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">— ninguém em particular —</option>
              {equipa.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            {!equipa.length && <small>Grave primeiro a equipa para poder escolher uma pessoa.</small>}
          </label>

          {!pedir && (
            <div className={s.opcoes} role="radiogroup" aria-label="Meio">
              {disp === null && <p className={s.vazio}>A verificar disponibilidade…</p>}
              {disp?.map((m) => (
                <label key={m.id} className={s.opcao} data-livre={m.disponivel} data-escolhido={escolhido === m.id}>
                  <input type="radio" name="meio" disabled={!m.disponivel} checked={escolhido === m.id}
                         onChange={() => setEscolhido(m.id)} />
                  <span>
                    <span><b>{descricaoMeio(m)}</b>{m.matricula ? ` · ${m.matricula}` : ""}{m.propriedade === "alugado" ? " · alugado" : ""}</span>
                    <small>{m.disponivel ? "Disponível" : m.motivos.map((x) => x.texto).join(" · ")}</small>
                  </span>
                </label>
              ))}
              {disp && !livres.length && (
                <p className={s.semLivres}>
                  {tipoEscolhido
                    ? <>Nenhum meio «{tipoEscolhido.nome}»{capNum ? ` com pelo menos ${capMin} ${unidade}` : ""} disponível neste período.</>
                    : <>{tipo === "pesado" ? "Nenhum" : "Nenhuma"} {nomeTipo} disponível neste período.</>}
                </p>
              )}
            </div>
          )}

          {pedir && (
            <div className={s.pedido}>
              <p className={s.vazio}>
                Pedido externo de {nomeTipo}: a compra/aluguer segue o processo normal (PR/PO). Aqui registamos só a
                referência da PO, que pode ser indicada agora ou mais tarde.
              </p>
              <label className={s.linha}>Descrição
                <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)}
                       placeholder={descricaoPadrao} />
              </label>
              <div className={s.linha}>
                <label>Referência da PO <input type="text" value={po} onChange={(e) => setPo(e.target.value)} placeholder="opcional" /></label>
                <label>Fornecedor <input type="text" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="opcional" /></label>
              </div>
            </div>
          )}

          {erro && <p className={s.erro} role="alert">{erro}</p>}

          <div className={s.accoes}>
            {!pedir ? (
              <button type="button" className={s.btnLinha} onClick={() => setPedir(true)}>Pedir externamente</button>
            ) : (
              <button type="button" className={s.btnLinha} onClick={() => setPedir(false)}>← Escolher do parque</button>
            )}
            <span className={s.espaco} />
            <button type="button" className="btn" onClick={() => setAberto(false)}>Cancelar</button>
            {pedir ? (
              <button type="button" className={s.btnPrimario} onClick={registarPedido} disabled={aGravar}>
                {aGravar ? "A registar…" : "Registar pedido"}
              </button>
            ) : (
              <button type="button" className={s.btnPrimario} onClick={afectar} disabled={!escolhido || aGravar}>
                {aGravar ? "A afectar…" : "Afectar"}
              </button>
            )}
          </div>
        </div>
      )}
      {!aberto && erro && <p className={s.erro} role="alert">{erro}</p>}
    </section>
  );
}
