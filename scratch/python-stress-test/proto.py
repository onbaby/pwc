"""Throwaway prototype to sanity-check the v2 design (inventory-aware particle filter + sim + policies).
Not shipped. Python is used only to learn what the TypeScript spec should say."""
import numpy as np, math, sys, json, os
from collections import defaultdict

SRC = {  # n, ret90, ret12, aov
 'in_cafe': (2140, .71, .38, 34), 'website': (1860, .54, .22, 41), 'social': (3420, .39, .11, 29),
 'gift': (940, .62, .31, 46), 'referral': (310, .78, .51, 52)}
GM = 0.61
TMED = {'in_cafe': 64, 'website': 66, 'social': 78, 'gift': 74, 'referral': 60}
CADS = np.array([28, 42, 56, 84])
H = 365
P = dict(tau_pop=0.30, sigma_b=0.15, eps_bias=-0.10, eps_sd=0.15, p_skip=0.25, skip_thr=21,
         ev_prob_month=0.08, ev_mult=0.4, drift_sd=0.02, reply=0.45, noise=0.10,
         plenty=14, out=3, lam=0.5, svc_q=0.10, grace=3, wmax_ratio=1.7, p_sooner=0.60, p_revert=0.05,
         nu=0.10, obs_sd=0.35, M=300, cost_per_subyear=2.0, check_before=10, transit=0)

def make_sub(i, src, seed, P):
    r = np.random.default_rng([seed, i])
    cups = r.choice([1, 2, 3], p=[.3, .45, .25]); hh = r.choice([1, 2, 3], p=[.3, .4, .3])
    theta = math.log(TMED[src]) - .25 * (cups - 2) - .15 * (hh - 2) + r.normal(0, P['tau_pop'])
    mis = r.random() < .25
    cups_o = r.choice([1, 2, 3]) if mis else cups
    hh_o = r.choice([1, 2, 3]) if mis else hh
    eps = r.normal(P['eps_bias'], P['eps_sd'])
    T = math.exp(theta)
    c_fixed = CADS[np.argmin(np.abs(np.log(CADS) - (theta + eps)))]
    # random streams (common random numbers across policies)
    z_pace = r.standard_normal(H + 40) * P['drift_sd']
    ev = np.zeros(H + 40)
    d = 0
    while d < H + 40:
        if r.random() < P['ev_prob_month'] / 30:
            dur = int(r.integers(14, 36)); ev[d:d + dur] = 1; d += dur
        d += 1
    return dict(src=src, theta=theta, cups_o=cups_o, hh_o=hh_o, c_fixed=int(c_fixed), z_pace=z_pace, ev=ev,
                zbox=r.standard_normal(40), u_skip=r.random(40), u_reply=r.random(40), u_cls=r.random(40),
                u_acc=r.random(40), z_pf=np.random.default_rng([seed, i, 99]))

class PF:
    def __init__(self, mu, tau, P, rng):
        self.P = P; self.rng = rng; M = P['M']
        self.theta = rng.normal(mu, tau, M); self.w = np.ones(M) / M; self.R = np.zeros(M); self.t = 0.0
    def prop(self, t):
        dt = t - self.t
        if dt > 0:
            pace = np.exp(self.P['nu'] * math.sqrt(dt / 30) * self.rng.standard_normal(len(self.R)))
            self.R = np.maximum(self.R - dt * pace, 0)
        self.t = t
    def deliver(self):
        self.R = self.R + np.exp(self.theta + self.P['sigma_b'] * self.rng.standard_normal(len(self.R)))
    def cls(self, R):
        P = self.P
        return np.where(R > P['plenty'], 0, np.where(R > P['out'], 1, 2))
    def observe(self, c, eps):
        lik = np.where(self.cls(self.R) == c, 1 - eps, eps / 2)
        self.w = self.w * lik; s = self.w.sum()
        self.w = self.w / s if s > 0 else np.ones(len(self.w)) / len(self.w)
        ess = 1 / np.sum(self.w ** 2)
        if ess < len(self.w) / 2:
            M = len(self.w); u = (self.rng.random() + np.arange(M)) / M
            idx = np.minimum(np.searchsorted(np.cumsum(self.w), u), M - 1)
            self.theta = self.theta[idx] + self.rng.normal(0, .01, M); self.R = self.R[idx]; self.w = np.ones(M) / M
    def observe_days(self, obs_days, sd, eps):
        Rr = np.maximum(self.R, 2.0); x = max(obs_days, 2.0)
        pdf = np.exp(-0.5 * ((np.log(x) - np.log(Rr)) / sd) ** 2) / (x * sd * math.sqrt(2 * math.pi))
        lik = (1 - eps) * pdf + eps * (1.0 / 90.0)
        self.w = self.w * lik; s_ = self.w.sum()
        self.w = self.w / s_ if s_ > 0 else np.ones(len(self.w)) / len(self.w)
        ess = 1 / np.sum(self.w ** 2)
        if ess < len(self.w) / 2:
            M = len(self.w); u = (self.rng.random() + np.arange(M)) / M
            idx = np.minimum(np.searchsorted(np.cumsum(self.w), u), M - 1)
            self.theta = self.theta[idx] + self.rng.normal(0, .01, M); self.R = self.R[idx]; self.w = np.ones(M) / M
    def observe_gt(self, thr):  # implicit: R > thr (skip)
        lik = np.where(self.R > thr, 0.95, 0.05); self.w = self.w * lik; self.w /= self.w.sum()
    def q(self, qs):
        o = np.argsort(self.R); cw = np.cumsum(self.w[o]); Rs = self.R[o]
        return [Rs[min(np.searchsorted(cw, qq), len(Rs) - 1)] for qq in np.atleast_1d(qs)]

def fit_prior(P, seed=1, n=4000):
    """Empirical Bayes: OLS of true theta on source dummies + observed signup answers (synthetic training split)."""
    X, y = [], []
    srcs = list(SRC); tot = sum(v[0] for v in SRC.values())
    for k in range(n):
        s = np.random.default_rng([seed, k, 5]).choice(srcs, p=[SRC[x][0] / tot for x in srcs])
        sub = make_sub(k + 10_000, s, seed, P)
        X.append([1.0 * (s == x) for x in srcs] + [sub['cups_o'] - 2, sub['hh_o'] - 2, math.log(sub['c_fixed']) - 3.9]); y.append(sub['theta'])
    X = np.array(X); y = np.array(y); beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ beta
    return dict(beta=beta, srcs=srcs, tau=float(res.std()))

def prior_mu(sub, pri):
    s = sub['src']; b = pri['beta']
    return sum(b[i] * (1.0 if pri['srcs'][i] == s else 0) for i in range(len(pri['srcs']))) + b[-3] * (sub['cups_o'] - 2) + b[-2] * (sub['hh_o'] - 2) + b[-1] * (math.log(sub['c_fixed']) - 3.9)

def snap_cad(med):
    return int(min(84, max(28, 7 * round(med / 7))))

def run_sub(sub, policy, pri, P, record=False):
    """Return daily R series (len H), delivery days (list of days of actual delivery), stats."""
    zp, ev = sub['z_pace'], sub['ev']
    theta = sub['theta']; sb = P['sigma_b']
    R = 0.0
    Rd = np.zeros(H); cons = np.zeros(H); deliveries = []; sched = 0  # next arrival day
    nd = 0  # delivery count for random streams
    ncyc = 0
    last_arr = None
    pf = None
    mu = prior_mu(sub, pri)
    if policy in ('smart', 'rule', 'naive', 'oracle'):
        cad_cur = sub['c_fixed']
    elif policy == 'quiz':
        sd_tot = math.sqrt(pri['tau'] ** 2 + P['sigma_b'] ** 2)
        zq = {0.05: -1.645, 0.10: -1.2816, 0.2: -0.8416, 0.5: 0}[P['svc_q']]
        cad_cur = snap_cad(math.exp(mu + zq * sd_tot) + P['grace'])
    else:
        cad_cur = sub['c_fixed']
    if policy == 'smart':
        pf = PF(mu, pri['tau'], P, sub['z_pf'])
    check_done = False
    arrivals_R_before = []; late_days_before = []; pile_series = np.ones(H) * -1.0; cur_pile = -1.0; zrun = 0; late_flags = []
    t = 0
    next_arr = 0
    check_day = None
    cyc_idx = 0
    stockout_days = 0
    for t in range(H):
        # deliveries scheduled today
        if t == next_arr:
            # customer-initiated skip
            if len(deliveries) > 0 and R >= P['skip_thr'] and sub['u_skip'][min(nd, 39)] < P['p_skip']:
                nd += 1
                next_arr = t + cad_cur
                check_day = next_arr - P['check_before']
                if pf is not None:
                    pf.prop(t); pf.observe_gt(P['skip_thr'])
            else:
                arrivals_R_before.append(R); late_flags.append(zrun >= 3)
                cur_pile = R if len(deliveries) > 0 else -1.0
                box = math.exp(theta + sb * sub['zbox'][min(nd, 39)])
                R += box; nd += 1; deliveries.append(t)
                if pf is not None:
                    pf.prop(t); pf.deliver()
                last_arr = t
                next_arr = t + cad_cur
                check_day = next_arr - P['check_before']
        # check-in (policy specific)
        if policy not in ('fixed', 'quiz') and check_day is not None and t == check_day:
            true_R = R
            c = 0 if true_R > P['plenty'] else (1 if true_R > P['out'] else 2)
            mult = (0.8, 1.2, 1.5)[c]
            pr = min(0.9, P['reply'] * mult)
            replied = (policy == 'oracle') or (sub['u_reply'][min(cyc_idx, 39)] < pr)
            wk = None
            if replied:
                if sub['u_cls'][min(cyc_idx, 39)] < P['noise']:
                    wk = int(sub['u_acc'][min(cyc_idx, 39)] * 1000) % 13        # garbage reply
                else:
                    zq_ = sub['z_pf'].standard_normal() * (0.0 if policy == 'oracle' else P['obs_sd'])
                    wk = int(min(12, max(0, round(max(true_R, 0.0) * math.exp(zq_) / 7))))
            step = 0
            if policy == 'naive':
                step = 7
            elif policy == 'rule' and replied:
                step = 14 if wk >= 4 else (7 if wk >= 2 else (0 if wk == 1 else -7))
            elif policy == 'oracle':
                raw = (t + true_R + 1) - next_arr
                step = 7 * int(round(raw / 7))
            elif policy == 'smart':
                pf.prop(t)
                if replied:
                    pf.observe_days(wk * 7.0, P['obs_sd'], P['noise'])
                q10, q50, q90 = pf.q([P['svc_q'], .5, .9])
                ratio = (q90 + 1) / (q10 + 1)
                tgt = t + q10 + P['grace']
                raw = tgt - next_arr
                s_ = int(round(raw / 7)); s_ = max(-2, min(2, s_)); step = 7 * s_ if replied else 0
                sub.setdefault('_log', []).append((t, bool(replied), wk, round(float(q10), 1), round(float(q50), 1), round(float(q90), 1), round(float(ratio), 2), step))
            if step != 0:
                new_arr = next_arr + step
                gap = new_arr - last_arr if last_arr is not None else cad_cur
                new_arr = max(last_arr + 21, min(last_arr + 84, new_arr)) if last_arr is not None else new_arr
                if new_arr < next_arr:  # sooner needs YES
                    if policy == 'oracle' or sub['u_acc'][min(cyc_idx, 39)] < P['p_sooner']: next_arr = new_arr
                else:
                    if sub['u_acc'][min(cyc_idx, 39)] >= P['p_revert']: next_arr = new_arr
            cyc_idx += 1
            check_day = None
        # daily consumption
        pace = math.exp(zp[t]) * (P['ev_mult'] if ev[t] else 1.0)
        if len(deliveries) > 0:
            Rn = max(R - pace, 0.0); cons[t] = R - Rn; R = Rn
        Rd[t] = R
        zrun = zrun + 1 if (R <= 0.0 and len(deliveries) > 0) else 0
        pile_series[t] = cur_pile
    sub['_cons'] = cons
    return Rd, deliveries, arrivals_R_before, pile_series, late_flags

def evaluate(policy, N_per_src, pri, P, seed=7, phis=(0, .2, .4, .6, .8)):
    out = {}
    Rall = {}; delivs = {}; subs = {}
    for s in SRC:
        subs[s] = [make_sub(j, s, seed, P) for j in range(N_per_src)]
    return subs

def calibrate_and_score(paths_fixed, paths_pol, P, phi_for, phi):
    """paths_*: dict src -> list of (Rd, deliveries). Returns per-source and blended metrics using expected survival."""
    res = {}
    pref = {}
    for s in SRC:
        allp = np.concatenate([p[2][p[2] >= 0] for p in paths_fixed[s]]); pref[s] = max(float(allp.mean()), 1.0)
    def arrays(paths, s):
        A = np.zeros((len(paths), H)); B = np.zeros((len(paths), H))
        for i, (Rd, dl, ps, lf, cn) in enumerate(paths):
            # run-out event: >=3 consecutive zero days; flag for 30 days after
            z = (Rd <= 0.0).astype(int); run = np.zeros(H); c_ = 0
            for tt in range(H):
                c_ = c_ + 1 if z[tt] else 0; run[tt] = c_
            ev_day = (run == 3).astype(float)
            ro30 = np.convolve(ev_day, np.ones(30), 'full')[:H] > 0
            mult = 1 + P['lam'] * ro30
            u = np.where(ps < 0, 1.0, np.minimum(ps / pref[s], 3))
            A[i] = mult; B[i] = u * mult
        return A, B
    h0 = {}
    for s in SRC:
        n, r90, r12, aov = SRC[s]
        A, B = arrays(paths_fixed[s], s); ph = phi_for(s, phi)
        X = (1 - ph) * A + ph * B
        c = np.cumsum(X, axis=1)
        # segment 1: days 0..89
        X1 = c[:, 89]; lo, hi = 1e-9, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if np.mean(np.exp(-mid * X1)) > r90: lo = mid
            else: hi = mid
        h1 = (lo + hi) / 2
        X2 = c[:, H - 1] - c[:, 89]; lo, hi = 1e-9, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if np.mean(np.exp(-h1 * X1 - mid * X2)) > r12 / 1.0: lo = mid
            else: hi = mid
        h0[s] = (h1, (lo + hi) / 2)
    tot = {}
    for s in SRC:
        n, r90, r12, aov = SRC[s]
        A, B = arrays(paths_pol[s], s); ph = phi_for(s, phi)
        X = (1 - ph) * A + ph * B
        hz = np.where(np.arange(H) < 90, h0[s][0], h0[s][1])[None, :] * X
        cum = np.cumsum(hz, axis=1); S = np.exp(-cum)
        deliv = np.zeros((len(paths_pol[s]), H))
        for i, (_, dl, _p, _l, _c) in enumerate(paths_pol[s]):
            for d in dl: deliv[i, d] = 1
        n_del = (deliv * S).sum(1)
        subyears = S.sum(1) / 365
        gp = n_del * aov * GM
        cons_boxes = np.array([(p_[4] * S[i]).sum() for i, p_ in enumerate(paths_pol[s])]); gp_c = cons_boxes * aov * GM
        Rm = np.array([p[0] for p in paths_pol[s]])
        pile = ((np.array([R for R in []])) if False else None)
        res[s] = dict(gpc=float(gp_c.mean()), ret90=float(S[:, 89].mean()), ret12=float(S[:, H - 1].mean()), gp=float(gp.mean()),
                      deliveries=float(n_del.mean()), subyears=float(subyears.mean()),
                      deliv_per_active_year=float(n_del.sum() / max(subyears.sum(), 1e-9)),
                      mean_stock=float((Rm * S).sum() / S.sum()))
    return res

def main():
    P_ = dict(P)
    pri = fit_prior(P_)
    print('prior fit tau=%.3f' % pri['tau'])
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    seed = 7
    subs = {s: [make_sub(j, s, seed, P_) for j in range(N)] for s in SRC}
    pols = ['fixed', 'quiz', 'rule', 'naive', 'smart', 'oracle']
    paths = {}
    meta = {}
    for pol in pols:
        paths[pol] = {}
        stock_arr = []; late = 0; narr = 0; pile14 = 0
        for s in SRC:
            lst = []
            for sub in subs[s]:
                sub.pop('_log', None)
                sub['z_pf'] = np.random.default_rng([seed, hash(s) % 1000, 99])
                Rd, dl, arrb, ps, lf = run_sub(sub, pol, pri, P_)
                lst.append((Rd, dl, ps, lf, sub['_cons'] / math.exp(sub['theta'])))
                narr += len(arrb); pile14 += sum(1 for x in arrb if x >= 14); late += sum(lf)
            paths[pol][s] = lst
        meta[pol] = dict(arr=narr, pile14=pile14 / max(narr, 1), late=late / max(narr, 1))
    print('event metrics (no churn, first-year paths):')
    for pol in pols:
        print(' ', pol, {k: round(v, 3) if isinstance(v, float) else v for k, v in meta[pol].items()})
    import os
    UNI = os.environ.get('UNI','0')=='1'
    def phi_for(s, phi): return phi if (UNI or s in ('in_cafe', 'website')) else 0.0
    for phi in tuple(float(x) for x in os.environ.get('PHIS','0,0.4,0.8,1.0').split(',')):
        print('phi=%.1f' % phi)
        base = None
        for pol in pols:
            r = calibrate_and_score(paths['fixed'], paths[pol], P_, phi_for, phi)
            w = {s: SRC[s][0] for s in SRC}; W = sum(w.values())
            gp = sum(r[s]['gp'] * w[s] for s in SRC) / W
            ret12 = sum(r[s]['ret12'] * w[s] for s in SRC) / W
            ret90 = sum(r[s]['ret90'] * w[s] for s in SRC) / W
            dl = sum(r[s]['deliv_per_active_year'] * w[s] for s in SRC) / W
            stock = sum(r[s]['mean_stock'] * w[s] for s in SRC) / W
            if pol == 'fixed': base = gp
            subyr = sum(r[s]['subyears'] * w[s] for s in SRC) / W
            net = gp - (P_['cost_per_subyear'] * subyr if pol in ('smart', 'rule', 'naive', 'quiz', 'oracle') else 0)
            gpc = sum(r[s]['gpc'] * w[s] for s in SRC) / W
            if pol == 'fixed': base_c = gpc
            print('  consumed-basis dGP %+.1f' % (gpc - base_c), end='')
            print('  %-6s ret90 %.3f ret12 %.3f deliv/act-yr %.2f meanstock %.1f GP/sub %.1f net %.1f dGP %+.1f cohortΔ$K %+.0f' % (
                pol, ret90, ret12, dl, stock, gp, net, net - base, (net - base) * 8670 / 1000))
    return subs, pri, paths

if __name__ == '__main__':
    main()
