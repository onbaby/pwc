import numpy as np, math, datetime as dt
import proto as p
P = dict(p.P); P['M'] = 4000
def day(d): return (d - dt.date(2026,8,5)).days   # day 0 = Maya's first delivery Aug 5
def mk(mu, tau, rng_seed):
    return p.PF(mu, tau, P, np.random.default_rng(rng_seed))
def show(label, pf, t, svc=0.10, grace=3, cur_arr=None):
    q10,q33,q50,q90 = pf.q([svc,.33,.5,.9])
    tgt = t + q10 + grace
    raw = tgt - cur_arr if cur_arr is not None else None
    step = 7*max(-2,min(2,int(round(raw/7)))) if raw is not None else None
    print(f"{label}: R q10/q33/q50/q90 = {q10:.1f}/{q33:.1f}/{q50:.1f}/{q90:.1f} days; ratio q90/q10={(q90+1)/(q10+1):.2f}; target arrival day {tgt:.0f}"
          + (f" -> raw shift {raw:+.1f} d, snapped step {step:+d} d" if raw is not None else ""))
    return q10,q50,q90
# --- Maya: deliveries Aug 5, Sep 2, Sep 30 ; next arrival Oct 28 ; today Oct 18 (check-in). prior median 40d, tau .2, sigma_b .15
d0 = dt.date(2026,8,5)
dels = [day(dt.date(2026,8,5)), day(dt.date(2026,9,2)), day(dt.date(2026,9,30))]
t_now = day(dt.date(2026,10,18)); cur_arr = day(dt.date(2026,10,28))
def maya(reply_weeks=None, seed=1, mu=math.log(40), tau=0.2):
    pf = mk(mu, tau, seed); pf.t = float(dels[0])
    pf.deliver()   # first
    for d in dels[1:]:
        pf.prop(d); pf.deliver()
    pf.prop(t_now)
    if reply_weeks is not None:
        pf.observe_days(reply_weeks*7.0, P['obs_sd'], P['noise'])
    return pf
for rw in (None, 6, 4, 2, 0):
    show(f"Maya reply={rw}", maya(rw), t_now, cur_arr=cur_arr)
# true R for story: T=38 per delivery
T=38.0; R_true = 3*T - (t_now - dels[0]); print('Maya TRUE pantry on Oct 18 (T=38):', R_true, 'days')
# --- Dev: first delivery Oct 12, today Oct 18 (day 6), no history, cold prior
pf = mk(math.log(45), 0.25, 3); pf.t = 0.0; pf.deliver(); pf.prop(6.0)
show("Dev day6 no reply", pf, 6.0, cur_arr=6+31)  # next arrival ~ 5 weeks after first
pf2 = mk(math.log(45), 0.25, 3); pf2.t = 0.0; pf2.deliver(); pf2.prop(6.0); pf2.observe_days(5*7.0, P['obs_sd'], P['noise'])
show("Dev day6 reply=5 weeks", pf2, 6.0, cur_arr=6+31)
# calendar sanity
for d in ("2026-10-18","2026-10-28","2026-11-02","2026-11-03","2026-11-04","2026-11-11"):
    print(d, dt.date.fromisoformat(d).strftime('%a'))
