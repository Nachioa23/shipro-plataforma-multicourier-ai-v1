/**
 * Tipos compartidos entre credenciales de couriers.
 *
 * Hoy hay dos couriers integrados (Andreani, Mocis) y no comparten campos.
 * Cada courier define su Interface en su propio archivo (andreani.ts, mocis.ts).
 *
 * Reservado para tipos futuros compartidos:
 * - CredencialesConVencimiento { expiraEn: Date; refreshUrl?: string } para
 *   couriers tipo Xubio que requieren refresh de token.
 * - EntornoCredenciales: 'sandbox' | 'live' para couriers con dual environment.
 */
export {};
