// Meios: viaturas, ferramentas/instrumentos e equipamento pesado (lógica do SHERT, simplificada).

export type TipoMeio = "viatura" | "ferramenta" | "pesado";
export type EstadoMeio = "operacional" | "limitado" | "manutencao" | "avariado";
export type Propriedade = "proprio" | "epal" | "alugado" | "outro";
export type EstadoPedido = "pedido" | "encomendado" | "chegou" | "devolvido" | "anulado";

/** Tipo do catálogo (Grua, Camião basculante, Calibrador 4-20 mA…). */
export interface TipoCatalogo {
  id: number;
  nome: string;
  categoria: TipoMeio;
  categoria_nome: string;
  unidade: string;          // unidade da capacidade ("t", "m³", "kVA"…); vazio = sem capacidade
  descricao: string;
  activo: boolean;
  ordem: number;
  meios: number;
}

export interface Meio {
  id: number;
  codigo: string;
  nome: string;
  tipo: TipoMeio;
  tipo_nome: string;
  tipo_meio: number | null;
  tipo_meio_nome: string | null;
  capacidade: string | null;
  unidade: string;
  capacidade_texto: string;
  propriedade: Propriedade;
  propriedade_nome: string;
  marca: string;
  modelo: string;
  matricula: string;
  numero_serie: string;
  responsavel: number | null;
  responsavel_nome: string | null;
  estado: EstadoMeio;
  estado_nome: string;
  activo: boolean;
  fornecedor: string;
  po_referencia: string;
  notas: string;
  actualizado_em: string;
  actualizado_por_nome: string | null;
  hoje: { id: number; texto: string; pessoa: string | null; periodo: string }[];
}

export interface Motivo {
  tipo: "inactivo" | "estado" | "alocado" | "capacidade";
  texto: string;
  alocacao?: number;
}

export interface MeioDisponivel {
  id: number;
  codigo: string;
  nome: string;
  tipo: TipoMeio;
  tipo_nome: string;
  tipo_meio: number | null;
  tipo_meio_nome: string | null;
  capacidade_texto: string;
  propriedade: Propriedade;
  matricula: string;
  disponivel: boolean;
  motivos: Motivo[];
}

export interface Alocacao {
  id: number;
  meio: number;
  meio_nome: string;
  meio_tipo: TipoMeio;
  tarefa: number | null;
  evento: number | null;
  pessoa: number | null;
  pessoa_nome: string | null;
  data_inicio: string;
  data_fim: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  notas: string;
  onde: string;
  periodo: string;
  criado_por_nome: string | null;
}

export interface PedidoMeio {
  id: number;
  tipo: TipoMeio;
  tipo_nome: string;
  tipo_meio: number | null;
  tipo_meio_nome: string | null;
  capacidade_minima: string | null;
  unidade: string;
  capacidade_texto: string;
  descricao: string;
  data_inicio: string;
  data_fim: string;
  tarefa: number | null;
  evento: number | null;
  onde: string | null;
  pessoa: number | null;
  pessoa_nome: string | null;
  estado: EstadoPedido;
  estado_nome: string;
  po_referencia: string;
  fornecedor: string;
  meio: number | null;
  meio_nome: string | null;
  chegou_em: string | null;
  devolvido_em: string | null;
  notas: string;
  criado_em: string;
  solicitado_por_nome: string | null;
  actualizado_por_nome: string | null;
  aviso?: string;
}

export interface Ocupacao {
  tipo: "tarefa" | "reuniao" | "visita";
  id: number;
  titulo: string;
  periodo: string;
}

export const TIPOS_MEIO: { id: TipoMeio; nome: string }[] = [
  { id: "viatura", nome: "Viatura" },
  { id: "ferramenta", nome: "Ferramenta / instrumento" },
  { id: "pesado", nome: "Equipamento pesado" },
];

export const ESTADOS_MEIO: { id: EstadoMeio; nome: string }[] = [
  { id: "operacional", nome: "Operacional" },
  { id: "limitado", nome: "Utilização limitada" },
  { id: "manutencao", nome: "Em manutenção" },
  { id: "avariado", nome: "Avariado" },
];

export const PROPRIEDADES: { id: Propriedade; nome: string }[] = [
  { id: "proprio", nome: "Próprio (SUEZ)" },
  { id: "epal", nome: "EPAL" },
  { id: "alugado", nome: "Alugado (PO)" },
  { id: "outro", nome: "Outro" },
];

export const ESTADOS_PEDIDO: { id: EstadoPedido; nome: string }[] = [
  { id: "pedido", nome: "A aguardar PO" },
  { id: "encomendado", nome: "PO emitida" },
  { id: "chegou", nome: "Chegou" },
  { id: "devolvido", nome: "Devolvido" },
  { id: "anulado", nome: "Anulado" },
];

/** Texto de um meio para listas: "GRU-20 · Grua Liebherr · Grua 20 t". */
export function descricaoMeio(m: { codigo: string; nome: string; tipo_meio_nome?: string | null; capacidade_texto?: string }): string {
  const tipo = [m.tipo_meio_nome, m.capacidade_texto].filter(Boolean).join(" ");
  return [m.codigo, m.nome, tipo && tipo !== m.nome ? tipo : ""].filter(Boolean).join(" · ");
}
