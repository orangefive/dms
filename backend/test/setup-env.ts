/** e2e 测试环境变量：使用独立的 dms_test 数据库 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root@127.0.0.1:3307/dms_test';
process.env.JWT_SECRET = 'test_jwt_secret_0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_0123456789abcdef';
process.env.API_KEY_SECRET = 'test_api_key_secret';
process.env.JWT_EXPIRES_IN = '30m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.BATCH_INSERT_LIMIT = '100';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER_ENABLED = 'false';
