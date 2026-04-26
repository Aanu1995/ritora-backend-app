import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

let lastJsonBody: Record<string, unknown> | undefined;

function captureJson(body: Record<string, unknown>): void {
  lastJsonBody = body;
}

const mockJson = jest.fn(captureJson);
const mockStatus = jest.fn().mockImplementation(() => ({
  json: mockJson,
}));
const mockGetResponse = jest.fn().mockReturnValue({ status: mockStatus });
const mockGetRequest = jest
  .fn()
  .mockReturnValue({ url: '/api/v1/test', headers: {}, body: {} });

const mockHost = {
  switchToHttp: jest.fn().mockReturnValue({
    getResponse: mockGetResponse,
    getRequest: mockGetRequest,
  }),
} as unknown as ArgumentsHost;

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jest.clearAllMocks();
    lastJsonBody = undefined;
  });

  it('handles HttpException responses', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not Found',
        path: '/api/v1/test',
      }),
    );
  });

  it('preserves array validation messages', () => {
    const exception = new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: ['email must be an email'],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['Enter a valid email address'],
      }),
    );
  });

  it('translates structured field errors when present', () => {
    const exception = new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: ['validation.email.invalid'],
        fieldErrors: {
          email: ['validation.email.invalid'],
        },
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['Enter a valid email address'],
        fieldErrors: {
          email: ['Enter a valid email address'],
        },
      }),
    );
  });

  it('preserves structured error codes when present', () => {
    const exception = new HttpException(
      {
        statusCode: HttpStatus.FORBIDDEN,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      },
      HttpStatus.FORBIDDEN,
    );

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      }),
    );
  });

  it('translates messages using the request language', () => {
    mockGetRequest.mockReturnValueOnce({
      url: '/api/v1/auth/login',
      headers: {},
      body: { language: 'sv' },
    });

    const exception = new HttpException(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Invalid credentials',
      },
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Ogiltiga inloggningsuppgifter',
      }),
    );
  });

  it('falls back to 500 for unknown exceptions', () => {
    const exception = new Error('Something broke');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
    expect(typeof lastJsonBody?.timestamp).toBe('string');
  });
});
