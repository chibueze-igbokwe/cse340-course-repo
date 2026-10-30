export const notFound = (req, res, next) => {
  const error = new Error('Page not found');
  error.status = 404;
  next(error);
};

export const testErrorPage = (req, res, next) => {
  next(new Error('This is a test error'));
};

export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = [400, 403, 404, 413, 415].includes(error.status) ? error.status : 500;
  if (status === 500) console.error('Request failed:', error);
  const requestMessages = {
    400: 'The submitted form could not be read. Return to the form and try again.',
    403: 'Your form session has expired. Reload the form and try again.',
    413: 'The submitted form is too large. Reduce its size and try again.',
    415: 'This form requires an uncompressed URL-encoded submission.'
  };
  res.status(status).render(status === 404 || status === 500 ? 'errors/' + status : 'errors/request', {
    title: (status === 404 ? 'Page Not Found' : status === 500 ? 'Server Error' : 'Invalid Request') + ' | Service Network',
    status, message: requestMessages[status],
    error: error.message,
    stack: error.stack
  });
};
