// Tipos e utilitários do Estado RTU (mesma lógica do Excel ProAgua_Estado_RTU_por_Sitio).

export type Fase = "cfg" | "mon" | "tst" | "sds";
export type Lote = "L1" | "L2" | "L3";
export type TipoSitio = "CD" | "ETA" | "UCD";

export interface Progresso {
  cfg: number;
  mon: number;
  tst: number;
  global: number;
}

export interface SitioResumo {
  id: number;
  tipo: TipoSitio;
  tipo_nome: string;
  nome: string;
  lote: Lote;
  rtu_modelo: string;
  ferramenta: string;
  entradas: string;
  modelo_rtu_nome: string | null;
  tipo_instalacao_nome: string;
  instalacao_detalhe: string;
  ordem: number;
  progresso: Progresso;
}

export interface LinhaPR {
  id: number;
  actividade: number;
  codigo: string;
  actividade_nome: string;
  fase: Fase;
  previsto: string; // DecimalField chega como texto ("1.0")
  realizado: string;
  actualizado_em: string;
  actualizado_por_nome: string | null;
}

export interface PLC {
  id: number;
  designacao: string;
  modelo_nome: string | null;
  integrador: string;
  accao: "manter" | "substituir" | "novo";
  accao_nome: string;
  modelo_substituto_nome: string | null;
  motivo_substituicao: string;
  estado_substituicao_nome: string;
  notas: string;
}

export interface Obstaculo {
  id: number;
  data: string;
  categoria_nome: string;
  entidade: string;
  descricao: string;
  impacto: string;
  solucao: string;
  estado: "aberto" | "resolvido";
  estado_nome: string;
}

export interface TarefaResumo {
  id: number;
  descricao: string;
  equipa_texto: string;
  inicio: string | null;
  fim: string | null;
  progresso: number;
  estado: string;
}

export interface SitioDetalhe extends SitioResumo {
  notas: string;
  actividades: LinhaPR[];
  plcs: PLC[];
  obstaculos: Obstaculo[];
  tarefas_abertas: TarefaResumo[];
}

export interface Painel {
  data: string;
  progresso_global: number;
  por_lote: Record<Lote, { sitios: number; progresso: number }>;
  sitios: { total: number; concluidos: number; em_curso: number; nao_iniciados: number };
}

export const FASES: { id: Exclude<Fase, "sds">; titulo: string; curto: string }[] = [
  { id: "cfg", titulo: "1. Configuração do RTU", curto: "Configuração" },
  { id: "mon", titulo: "2. Montagem física e subida de dados", curto: "Montagem" },
  { id: "tst", titulo: "3. Testes / Comissionamento", curto: "Testes" },
];

export const LOTES: { id: Lote; titulo: string }[] = [
  { id: "L1", titulo: "Lote 1 — Foco actual" },
  { id: "L2", titulo: "Lote 2" },
  { id: "L3", titulo: "Lote 3" },
];

export type Situacao = "concluido" | "em_curso" | "nao_iniciado";

/** Mesmas regras do formato condicional do Excel: =1, entre 0 e 1, =0. */
export function situacao(v: number): Situacao {
  if (v >= 0.9999) return "concluido";
  if (v > 0) return "em_curso";
  return "nao_iniciado";
}

export const SIMBOLO: Record<Situacao, string> = { concluido: "✔", em_curso: "◐", nao_iniciado: "○" };
export const SITUACAO_NOME: Record<Situacao, string> = {
  concluido: "Concluído",
  em_curso: "Em curso",
  nao_iniciado: "Não iniciado",
};

const fmt0 = new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("pt-PT", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function pct(v: number, casas: 0 | 2 = 0): string {
  return (casas === 2 ? fmt2 : fmt0).format(v);
}

/** % de uma fase a partir das linhas P/R: ΣR ÷ ΣP (0 se ΣP = 0), como no Excel. */
export function percentagemFase(linhas: { previsto: number; realizado: number }[]): number {
  const p = linhas.reduce((a, l) => a + l.previsto, 0);
  const r = linhas.reduce((a, l) => a + l.realizado, 0);
  return p ? r / p : 0;
}