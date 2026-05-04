"use client";

const DIAS = [
  { id: 'lunes', label: 'Lunes' },
  { id: 'martes', label: 'Martes' },
  { id: 'miercoles', label: 'Miércoles' },
  { id: 'jueves', label: 'Jueves' },
  { id: 'viernes', label: 'Viernes' },
  { id: 'sabado', label: 'Sábado' },
  { id: 'domingo', label: 'Domingo' },
] as const;

const FRANJAS = [
  { id: 'ma', label: '09-12' },
  { id: 'tarde1', label: '12-15' },
  { id: 'tarde2', label: '15-18' },
] as const;

export interface HorarioDia {
  ma: boolean;
  tarde1: boolean;
  tarde2: boolean;
  cerrado: boolean;
}

export type HorariosSemana = Record<string, HorarioDia>;

export const HORARIOS_DEFAULT: HorariosSemana = {
  lunes:     { ma: false, tarde1: true,  tarde2: false, cerrado: false },
  martes:    { ma: false, tarde1: true,  tarde2: false, cerrado: false },
  miercoles: { ma: false, tarde1: true,  tarde2: false, cerrado: false },
  jueves:    { ma: false, tarde1: true,  tarde2: false, cerrado: false },
  viernes:   { ma: false, tarde1: true,  tarde2: false, cerrado: false },
  sabado:    { ma: false, tarde1: false, tarde2: false, cerrado: true  },
  domingo:   { ma: false, tarde1: false, tarde2: false, cerrado: true  },
};

export function parsearHorarios(json: string | undefined | null): HorariosSemana {
  if (!json) return HORARIOS_DEFAULT;
  try {
    const obj = JSON.parse(json);
    // Mergeo defensivo: si falta algún día, completar con default
    const merged: HorariosSemana = { ...HORARIOS_DEFAULT };
    for (const dia of DIAS) {
      if (obj[dia.id]) merged[dia.id] = { ...HORARIOS_DEFAULT[dia.id], ...obj[dia.id] };
    }
    return merged;
  } catch {
    return HORARIOS_DEFAULT;
  }
}

interface Props {
  value: HorariosSemana;
  onChange: (next: HorariosSemana) => void;
  disabled?: boolean;
}

export default function HorariosEditor({ value, onChange, disabled }: Props) {
  const toggleFranja = (dia: string, franja: 'ma' | 'tarde1' | 'tarde2') => {
    if (disabled) return;
    const diaActual = value[dia];
    if (diaActual.cerrado) return;
    onChange({
      ...value,
      [dia]: { ...diaActual, [franja]: !diaActual[franja] },
    });
  };

  const toggleCerrado = (dia: string) => {
    if (disabled) return;
    const diaActual = value[dia];
    const nuevoCerrado = !diaActual.cerrado;
    onChange({
      ...value,
      [dia]: nuevoCerrado
        ? { ma: false, tarde1: false, tarde2: false, cerrado: true }
        : { ...diaActual, cerrado: false },
    });
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-[10px] font-black text-gray-500 uppercase tracking-wider">Día</th>
            {FRANJAS.map(f => (
              <th key={f.id} className="px-4 py-3 text-center text-[10px] font-black text-gray-500 uppercase tracking-wider">{f.label}</th>
            ))}
            <th className="px-4 py-3 text-center text-[10px] font-black text-gray-500 uppercase tracking-wider">Cerrado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {DIAS.map(d => {
            const dia = value[d.id];
            return (
              <tr key={d.id} className={dia.cerrado ? 'bg-gray-50/50' : ''}>
                <td className="px-4 py-2.5 font-bold text-gray-700 text-xs">{d.label}</td>
                {FRANJAS.map(f => (
                  <td key={f.id} className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={dia[f.id]}
                      onChange={() => toggleFranja(d.id, f.id)}
                      disabled={disabled || dia.cerrado}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </td>
                ))}
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={dia.cerrado}
                    onChange={() => toggleCerrado(d.id)}
                    disabled={disabled}
                    className="w-4 h-4 text-red-600 rounded border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
