"use client";

import { DIAS_CURTOS, ESTADOS, iso, ocupa, type Pessoa, type Tarefa } from "@/lib/planeamento";
import s from "./planeamento.module.css";

interface Props {
  tarefas: Tarefa[];
  pessoas: Pessoa[];
  dias: Date[];
  hoje: string;
  onAbrir: (t: Tarefa) => void;
}

const MAX_POR_DIA = 3; // além disto mostra "+n"

/** Quem faz o quê, dia a dia: uma linha por pessoa, 14 colunas. */
export default function CalendarioPessoas({ tarefas, pessoas, dias, hoje, onAbrir }: Props) {
  const diasIso = dias.map(iso);

  const linhas = pessoas
    .map((p) => {
      const suas = tarefas.filter((t) => t.equipa.includes(p.id));
      return {
        pessoa: p,
        porDia: diasIso.map((di) => suas.filter((t) => ocupa(t, di))),
        semData: suas.filter((t) => !t.inicio),
        total: suas.length,
      };
    })
    .filter((l) => l.total > 0);

  if (!linhas.length) {
    return <p className={s.vazio}>Ninguém tem tarefas atribuídas nesta janela com os filtros escolhidos.</p>;
  }

  return (
    <div className={s.rolagem}>
      <table className={s.calendario}>
        <thead>
          <tr>
            <th className={s.cPessoa}>Pessoa</th>
            {dias.map((d, i) => (
              <th key={diasIso[i]} className={`${s.diaLargo} ${d.getDay() % 6 === 0 ? s.fds : ""} ${diasIso[i] === hoje ? s.hoje : ""}`}>
                <small>{DIAS_CURTOS[(d.getDay() + 6) % 7]}</small> {d.getDate()}
              </th>
            ))}
            <th className={s.cSemData} title="Tarefas abertas sem datas">Sem data</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(({ pessoa, porDia, semData }) => (
            <tr key={pessoa.id}>
              <th scope="row" className={s.cPessoa}>
                {pessoa.nome}
                {pessoa.funcao && <small>{pessoa.funcao}</small>}
              </th>
              {porDia.map((lista, i) => {
                const d = dias[i];
                const sobrecarga = lista.length > MAX_POR_DIA;
                return (
                  <td key={diasIso[i]}
                      className={`${s.diaLargo} ${d.getDay() % 6 === 0 ? s.fds : ""} ${diasIso[i] === hoje ? s.hoje : ""} ${sobrecarga ? s.sobrecarga : ""}`}>
                    {lista.slice(0, MAX_POR_DIA).map((t) => (
                      <button key={t.id} type="button" className={s.ficha} data-estado={t.estado}
                              title={`${t.localizacao} — ${t.descricao} (${ESTADOS[t.estado]})`}
                              onClick={() => onAbrir(t)}>
                        {t.localizacao}
                      </button>
                    ))}
                    {sobrecarga && (
                      <span className={s.mais} title={lista.slice(MAX_POR_DIA).map((t) => `${t.localizacao} — ${t.descricao}`).join("\n")}>
                        +{lista.length - MAX_POR_DIA}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className={s.cSemData}>
                {semData.length ? (
                  <span className={s.contagem} title={semData.map((t) => `${t.localizacao} — ${t.descricao}`).join("\n")}>
                    {semData.length}
                  </span>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}