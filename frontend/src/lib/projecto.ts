// Visão global do projecto: Montagem calculada pelos elementos de campo do sinóptico.
// As páginas "Estado RTU" continuam a usar src/lib/estado.ts (P/R do Excel).

export type Sistema = "S1" | "S2" | "S3_LSE" | "S3_LSK" | "PER" | "";
export type Categoria = "alim" | "bab" | "bat" | "caud" | "pres" | "niv" | "qual";
export type EstadoFisico = "por_instalar" | "instalado" | "substituido" | "existente";
export type Accao = "ligar" | "conservar" | "reparar" | "substituir" | "instalar" | "por_definir";
export type Vista = "" | "falta_instalar" | "sem_dados" | "concluidos" | "a_confirmar" | "na";

export interface PR { p: number; r: number }

export interface LinhaSitio {
  id: number;
  tipo: "CD" | "ETA" | "UCD";
  nome: string;
  lote: string;
  sistema: Sistema;
  sistema_nome: string;
  cfg: number;
  mon: number;
  tst: number;
  global: number;
  montagem: Partial<Record<Categoria, PR>>;
  pontos: PR;
  elementos: number;
  por_instalar: number;
  a_confirmar: number;
  na: number;
}

export interface Dashboard {
  data: string;
  progresso_global: number;
  fases: { cfg: number; mon: number; tst: number };
  sitios: { total: number; concluidos: number; em_curso: number; nao_iniciados: number };
  elementos: {
    total: number; pontos_previstos: number; pontos_concluidos: number;
    por_instalar: number; a_confirmar: number; na: number;
  };
  por_sistema: { sistema: Sistema; nome: string; sitios: number; progresso: number; cfg: number; mon: number; tst: number }[];
  por_categoria: { categoria: Categoria; nome: string; p: number; r: number; progresso: number }[];
  por_sitio: LinhaSitio[];
}

export interface Elemento {
  id: number;
  sitio: number;
  sitio_nome: string;
  grupo: string;
  categoria: Categoria;
  categoria_nome: string;
  agua: "" | "bruta" | "tratada";
  nome: string;
  tag: string;
  quantidade: number;
  accao_prevista: Accao;
  accao_nome: string;
  estado_fisico: EstadoFisico;
  estado_fisico_nome: string;
  concluidos: number;
  concluido: boolean;
  aplicavel: boolean;
  motivo_na: string;
  origem: "sinoptico" | "manual";
  a_confirmar: boolean;
  notas: string;
  ordem: number;
  actualizado_em: string;
  actualizado_por_nome: string | null;
}

export const SISTEMAS: { id: Exclude<Sistema, "">; nome: string; curto: string }[] = [
  { id: "S1", nome: "Sistema I", curto: "S. I" },
  { id: "S2", nome: "Sistema II", curto: "S. II" },
  { id: "S3_LSE", nome: "Sistema III · Luanda Sudeste", curto: "S. III LSE" },
  { id: "S3_LSK", nome: "Sistema III · Luanda Sul e Kikuxi", curto: "S. III LSK" },
  { id: "PER", nome: "Periféricos", curto: "Periféricos" },
];

export const CATEGORIAS: { id: Categoria; nome: string }[] = [
  { id: "alim", nome: "Alimentações (ENDE / gerador)" },
  { id: "bab", nome: "Bombas água bruta" },
  { id: "bat", nome: "Bombas água tratada" },
  { id: "caud", nome: "Caudalímetros" },
  { id: "pres", nome: "Sensores de pressão" },
  { id: "niv", nome: "Sensores de nível" },
  { id: "qual", nome: "Qualidade da água" },
];

export const ESTADOS_FISICOS: { id: EstadoFisico; nome: string }[] = [
  { id: "existente", nome: "Existente" },
  { id: "por_instalar", nome: "Por instalar" },
  { id: "instalado", nome: "Instalado" },
  { id: "substituido", nome: "Substituído" },
];

export const ACCOES: { id: Accao; nome: string }[] = [
  { id: "ligar", nome: "Ligar" },
  { id: "conservar", nome: "Conservar" },
  { id: "reparar", nome: "Reparar" },
  { id: "substituir", nome: "Substituir" },
  { id: "instalar", nome: "Instalar" },
  { id: "por_definir", nome: "Por definir" },
];

export const VISTAS: { id: Exclude<Vista, "">; nome: string; ajuda: string }[] = [
  { id: "falta_instalar", nome: "Por instalar", ajuda: "Equipamento a instalar ou substituir que ainda não está no terreno" },
  { id: "sem_dados", nome: "Sem dados no RTU", ajuda: "Existe no terreno mas os dados ainda não chegam (todos) ao RTU" },
  { id: "a_confirmar", nome: "A confirmar", ajuda: "Realizado herdado do Excel por categoria — verificar no terreno" },
  { id: "concluidos", nome: "Concluídos", ajuda: "Todos os pontos com dados a chegar ao RTU" },
  { id: "na", nome: "N/A", ajuda: "Marcados como não aplicáveis (não contam no previsto)" },
];

/** Situação de um elemento, para cor e ordenação. */
export function situacaoElemento(e: Elemento): "na" | "por_instalar" | "concluido" | "parcial" | "sem_dados" {
  if (!e.aplicavel) return "na";
  if (e.estado_fisico === "por_instalar") return "por_instalar";
  if (e.concluidos >= e.quantidade) return "concluido";
  if (e.concluidos > 0) return "parcial";
  return "sem_dados";
}

/** Montagem de uma lista de elementos: Σ concluídos ÷ Σ quantidade dos aplicáveis. */
export function montagem(els: Elemento[]): PR & { v: number } {
  const ap = els.filter((e) => e.aplicavel);
  const p = ap.reduce((a, e) => a + e.quantidade, 0);
  const r = ap.reduce((a, e) => a + e.concluidos, 0);
  return { p, r, v: p ? r / p : 0 };
}

const n0 = new Intl.NumberFormat("pt-PT");
export function num(v: number): string {
  return n0.format(v);
}

/** CSV com ";" (o Excel em PT abre directamente) e BOM para os acentos. */
export function csv(linhas: (string | number)[][]): Blob {
  const esc = (v: string | number) => {
    const t = String(v ?? "");
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return new Blob(["﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export function guardarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
