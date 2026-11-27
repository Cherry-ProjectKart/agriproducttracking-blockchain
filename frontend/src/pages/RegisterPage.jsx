import RegisterForm from '../components/auth/RegisterForm.jsx';

/** Account creation for Farmer, Distributor and Retailer. Consumers do not need an account. */
export default function RegisterPage({ onRegister, onNavigate }) {
  return (
    <div className="auth-page">
      <section className="auth-intro" aria-labelledby="register-intro-heading">
        <h1 id="register-intro-heading" className="auth-intro__title">
          Blockchain Product Tracking
        </h1>
        <p className="auth-intro__text">
          Create an account to register product batches, record shipments or confirm receipt. Consumers do not
          need an account: they open the tracking page from a product&apos;s QR code.
        </p>
      </section>

      <section className="auth-card" aria-labelledby="register-heading">
        <h2 id="register-heading" className="auth-card__title">
          Create your account
        </h2>
        <p className="auth-card__subtitle">Choose the role that matches your work in the supply chain.</p>
        <RegisterForm onRegister={onRegister} onNavigate={onNavigate} />
      </section>
    </div>
  );
}
