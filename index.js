const express = require('express');
const path = require('path')
const session = require('express-session');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

// env
SK = process.env.SK;

const stripe = require('stripe')(SK);

const app = express();
app.use(express.json());

// Configuración de Express
app.use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configuración de sesiones
app.use(session({
  secret: '90re25tr35ed3523sdqw257gryu8525epetrxckkkasdheyyr648sxa2pxo$$ah24j2l3ll34ksd89a013bc$sdjk324mioiy7yysf09',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // Sin HTTPS, secure: false en desarrollo
    httpOnly: true,
  },
  name: 'session_id'
}));

app.use((req, res, next) => {
  if (!req.session.attempts) {
    req.session.attempts = 0;
  }
  next();
});

const testUser = {
  email: "yasabes@mail.com",
  password: "102030405060A"
};

app.get('/', (req, res) => {
  console.log('Sesión:', req.session);
  const errorMessage = req.query.errorMessage || null;
  res.render('index', { user: req.session.user, errorMessage });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (req.session.attempts >= 3) {
    return res.redirect('/?errorMessage=Too many failed attempts. Try again later.');
  }

  if (!emailPattern.test(email)) {
    req.session.attempts += 1;
    return res.redirect('/?errorMessage=Invalid email format.');
  }

  if (password.length < 6) {
    req.session.attempts += 1;
    return res.redirect('/?errorMessage=Password must be at least 6 characters.');
  }

  if (email === testUser.email && password === testUser.password) {
    req.session.user = { email };
    req.session.attempts = 0;
    return res.redirect('/');
  }

  req.session.attempts += 1;
  return res.redirect('/?errorMessage=Incorrect email or password');
});

app.get('/api/stripe-pk', (req, res) => {
  res.json({ publicKey: process.env.PK });
});

app.post('/payment', async (req, res) => {
  try {
    const { amount, currency, paymentMethodId } = req.body;

    console.log({ amount, currency, paymentMethodId })

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never", // Deshabilita redirecciones
      },
      metadata: {
        // Agrega metadatos adicionales
        user_id: '123'
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status
    });

  } catch (error) {
    // Captura errores específicos de Stripe
    const errorInfo = {
      code: error.code || 'server_error',
      message: error.message,
      type: error.type || 'api_error',
      decline_code: error.decline_code || null // Agrega decline_code si está disponible
    };

    console.error('Error en payment intent:', errorInfo);
    res.status(400).json({ error: errorInfo });
  }
});

// Webhook para capturar eventos asincrónicos
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailure(event.data.object);
      break;

    case 'charge.failed':
      await handleChargeFailure(event.data.object);
      break;

    // Agrega más eventos según necesites
  }

  res.json({ received: true });
});

// Manejar errores de pago
async function handlePaymentFailure(paymentIntent) {
  const lastError = paymentIntent.last_payment_error;
  console.error('Pago fallido:', {
    id: paymentIntent.id,
    code: lastError?.code,
    message: lastError?.message,
    decline_code: lastError?.decline_code
  });

  // Actualizar base de datos
  await db.collection('payments').updateOne(
    { stripeId: paymentIntent.id },
    { $set: { status: 'failed', error: lastError } }
  );
}

// Manejar éxito de pago
async function handlePaymentSuccess(paymentIntent) {
  // Actualizar base de datos
  await db.collection('payments').insertOne({
    stripeId: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: 'succeeded',
    created: new Date()
  });
}

PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});