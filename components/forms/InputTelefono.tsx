"use client";

interface Props {
  value: string;
  onChange: (raw10digits: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Input de teléfono argentino normalizado a 10 dígitos limpios.
 *
 * Convención del proyecto (DEUDA 4 - política "Consistencia de formularios"):
 * - El componente acepta SOLO 10 dígitos numéricos (max).
 * - En cada keystroke: strip de cualquier caracter no numérico + truncar a 10.
 * - Sin lógica de detección de prefijos (+54, 549, 0, 15) — el usuario aprende
 *   la convención por el feedback visual (contador X/10 + texto de ayuda).
 * - El sistema agrega +549 al despachar a WhatsApp / courier.
 *
 * Para integraciones externas (e-commerces vía API Key) que pueden mandar
 * teléfonos con prefijos variados: la normalización corre en el backend
 * antes de persistir. Ver DEUDA 25.
 *
 * El caller es responsable de validar `value.length === 10` antes de
 * persistir si el campo es requerido.
 */
export default function InputTelefono({ value, onChange, required, disabled, className, placeholder }: Props) {
  const limpiar = (raw: string) => raw.replace(/\D/g, '').substring(0, 10);

  const completos = value.length === 10;
  const incompleto = value.length > 0 && !completos;

  return (
    <div className="space-y-1">
      <input
        type="tel"
        value={value}
        onChange={e => onChange(limpiar(e.target.value))}
        required={required}
        disabled={disabled}
        placeholder={placeholder ?? "Ej: 1155772580"}
        inputMode="numeric"
        maxLength={10}
        className={className ?? `w-full border ${incompleto ? 'border-amber-400' : 'border-gray-300'} rounded-lg p-2.5 text-sm outline-none focus:border-[#233b6b]`}
      />
      <p className="text-[10px] font-medium text-gray-500">
        Sin código de país, sin 0 inicial, sin 15 móvil. Solo 10 dígitos.
      </p>
      {value.length > 0 && (
        <p className={`text-[10px] font-medium ${completos ? 'text-green-600' : 'text-amber-600'}`}>
          {value.length}/10 dígitos {completos && '✓'}
        </p>
      )}
    </div>
  );
}
