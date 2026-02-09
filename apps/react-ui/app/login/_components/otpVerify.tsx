export default function VerifyLoginPanel() {
  return (
    <div className="w-full md:w-1/2 flex flex-col justify-center items-center p-8 bg-white shadow-2xl md:shadow-none">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-3 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-glow">
              <svg
                className="svg-inline--fa fa-cube text-lg"
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="cube"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
              >
                <path
                  fill="currentColor"
                  d="M234.5 5.7c13.9-5 29.1-5 43.1 0l192 68.6C495 83.4 512 107.5 512 134.6V377.4c0 27-17 51.2-42.5 60.3l-192 68.6c-13.9 5-29.1 5-43.1 0l-192-68.6C17 428.6 0 404.5 0 377.4V134.6c0-27 17-51.2 42.5-60.3l192-68.6zM256 66L82.3 128 256 190l173.7-62L256 66zm32 368.6l160-57.1v-188L288 246.6v188z"
                />
              </svg>
            </div>
            <h1 className="font-bold text-2xl tracking-tight text-slate-900">
              Gestiabloc
            </h1>
          </div>

          <h2 className="text-3xl font-bold text-slate-900">
            Verify Your Login
          </h2>
          <p className="mt-2 text-slate-500">
            We&apos;ve sent a 6-digit code to your email address. Please enter
            it below to continue.
          </p>
        </div>

        <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700 text-center md:text-left">
              Enter OTP Code
            </label>

            <div
              className="flex justify-center md:justify-start gap-3"
              id="otp-inputs"
            >
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <input
                type="text"
                maxLength={1}
                className="otp-input"
                placeholder=""
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>

            <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-slate-500">
              <svg
                className="svg-inline--fa fa-clock"
                aria-hidden="true"
                focusable="false"
                data-prefix="far"
                data-icon="clock"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
              >
                <path
                  fill="currentColor"
                  d="M464 256A208 208 0 1 1 48 256a208 208 0 1 1 416 0zM0 256a256 256 0 1 0 512 0A256 256 0 1 0 0 256zM232 120V256c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24z"
                />
              </svg>
              <span>
                Code expires in{" "}
                <span className="font-semibold text-slate-700" id="timer">
                  04:49
                </span>
              </span>
            </div>
          </div>

          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg
                className="svg-inline--fa fa-info text-indigo-600 text-xs"
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="info"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 192 512"
              >
                <path
                  fill="currentColor"
                  d="M48 80a48 48 0 1 1 96 0A48 48 0 1 1 48 80zM0 224c0-17.7 14.3-32 32-32H96c17.7 0 32 14.3 32 32V448h32c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H64V256H32c-17.7 0-32-14.3-32-32z"
                />
              </svg>
            </div>

            <div className="text-sm text-slate-600">
              <p className="font-medium text-slate-700">
                Didn&apos;t receive the code?
              </p>
              <button
                type="button"
                className="text-indigo-600 hover:text-indigo-700 font-semibold hover:underline mt-1"
                id="resend-btn"
              >
                Resend OTP
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="submit"
              className="w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 shadow-glow"
            >
              <span>Verify &amp; Continue</span>
              <svg
                className="svg-inline--fa fa-arrow-right"
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="arrow-right"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 448 512"
              >
                <path
                  fill="currentColor"
                  d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"
                />
              </svg>
            </button>

            <button
              type="button"
              className="w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300 transition-all duration-200"
            >
              <svg
                className="svg-inline--fa fa-arrow-left"
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="arrow-left"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 448 512"
              >
                <path
                  fill="currentColor"
                  d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288 416 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-306.7 0L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"
                />
              </svg>
              <span>Back to Sign In</span>
            </button>
          </div>
        </form>

        <div className="pt-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full text-xs font-medium text-green-700">
            <svg
              className="svg-inline--fa fa-shield-halved"
              aria-hidden="true"
              focusable="false"
              data-prefix="fas"
              data-icon="shield-halved"
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
            >
              <path
                fill="currentColor"
                d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8V444.8C394 378 431.1 230.1 432 141.4L256 66.8l0 0z"
              />
            </svg>
            <span>Secure verification powered by Gestiabloc</span>
          </div>
        </div>
      </div>

      <div className="mt-12 text-center text-xs text-slate-400">
        © 2024 Gestiabloc Inc. All rights reserved.
      </div>
    </div>
  )
}
