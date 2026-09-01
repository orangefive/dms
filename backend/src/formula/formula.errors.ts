import { ErrorCodes } from '../common/enums/error-codes';

/** 公式错误：携带标准错误码与中文友好信息 */
export class FormulaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FormulaError';
    this.code = code;
  }

  static syntax(message: string): FormulaError {
    return new FormulaError(ErrorCodes.FORMULA_SYNTAX_ERROR, message);
  }
}
