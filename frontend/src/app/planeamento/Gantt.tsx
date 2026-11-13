"use client";

import { DIAS_CURTOS, ESTADOS, dataCurta, iso, ocupa, type Tarefa } from "@/lib/planeamento";
import s from "./planeamento.module.css";

interface Props {
  tarefas: Tarefa[];
  dias: Date[];
  hoje: string;
  onAbrir: (t: Tarefa) => void;
}

/** Tabela do planeamento semanal: uma linha por tarefa, agrupada por secção, com 14 dias de Gantt. */
export default function Gantt({ tarefas, dias, hoje, onAbrir }: Props) {
  const diasIso = dias.map(iso);
  const linhas: ({ tipo: "seccao"; nome: string; n: number } | { tipo: "tarefa"; t: Tarefa })[] = [];
  let actual: number | null = null;
  for (const t of tarefas) {
    if (t.seccao !== actual) {
      actual = t.seccao;
      linhas.push({ tipo: "seccao", nome: t.seccao_nome, n: tarefas.filter((x) => x.seccao === t.seccao).length });
    }
    linhas.push({ tipo: "tarefa", t });
  }

  return (
    <div className={s.rolagem}>
      <table className={s.gantt}>
        <thead>
          <tr>
            <th className={s.cLoc}>Localização</th>
            <th className={s.cAct}>Actividade</th>
            <th className={s.cEq}>Equipa obra</th>
            <th className={s.cNum} title="Recursos afectados">Rec.</th>
            <th className={s.cNum}>Progresso</th>
            <th className={s.cData}>Início</th>
            <th className={s.cData}>Fim</th>
            <th className={s.cNum}>Dias</th>
            {dias.map((d, i) => {
              const di = diasIso[i];
              return (
                <th key={di} className={`${s.dia} ${d.getDay() % 6 === 0 ? s.fds : ""} ${di === hoje ? s.hoje : ""}`}
                    title={d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}>
                  <small>{d.getDate()}</small>
                  {DIAS_CURTOS[(d.getDay() + 6) % 7]}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) =>
            l.tipo === "seccao" ? (
              <tr key={`s-${l.nome}`} className={s.linhaSeccao}>
                <td colSpan={8 + dias.length}>
                  {l.nome} em curso <span>{l.n} {l.n === 1 ? "tarefa" : "tarefas"}</span>
                </td>
              </tr>
            ) : (
              <tr key={l.t.id} className={s.linhaTarefa} tabIndex={0}
                  onClick={() => onAbrir(l.t)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAbrir(l.t))}>
                <td className={s.cLoc}>{l.t.localizacao}</td>
                <td className={s.cAct}>
                  {l.t.descricao}
                  {l.t.bloqueado && <span className={s.motivo}>Bloqueado: {l.t.motivo_bloqueio}</span>}
                </td>
                <td className={s.cEq}>{l.t.equipa_texto || "—"}</td>
                <td className={s.cNum}>{l.t.recursos ?? "—"}</td>
                <td className={s.cNum}>
                  <span className={s.prog}>
                    <i style={{ width: `${l.t.progresso}%` }} data-estado={l.t.estado} />
                  </span>
                  {l.t.progresso}%
                </td>
                <td className={s.cData}>{dataCurta(l.t.inicio)}</td>
                <td className={s.cData}>{dataCurta(l.t.fim)}</td>
                <td className={s.cNum}>{l.t.dias ?? "—"}</td>
                {dias.map((d, i) => {
                  const di = diasIso[i];
                  const cheio = ocupa(l.t, di);
                  return (
                    <td key={di} className={`${s.dia} ${d.getDay() % 6 === 0 ? s.fds : ""} ${di === hoje ? s.hoje : ""}`}>
                      {cheio && <i data-estado={l.t.estado} title={ESTADOS[l.t.estado]} />}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}