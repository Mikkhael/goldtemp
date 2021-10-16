module.exports = {
    NAME: process.env["DB_NAME"] || 'goldtemp_test',
    ADDR: process.env["DB_ADDR"] || 'localhost',
    PORT: process.env["DB_PORT"] || '3306',
    USER: process.env["DB_USER"] || 'root',
    PASS: process.env["DB_PASS"] || ''
};