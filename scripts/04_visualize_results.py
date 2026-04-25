"""
04_visualize_results.py
Professional results dashboard for the HydroSense leak-detection model.
Reproducibly recreates the same train/test split used in training (seed=42)
and generates a multi-panel figure saved to models/results_dashboard.png.
"""

import sys
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.colors import LinearSegmentedColormap
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, f1_score, confusion_matrix,
    roc_curve, auc, precision_recall_curve, average_precision_score,
    classification_report,
)

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

# ── Palette ──────────────────────────────────────────────────────────────────
BLUE    = "#2563EB"
TEAL    = "#0D9488"
AMBER   = "#D97706"
RED     = "#DC2626"
GRAY_BG = "#F8FAFC"
GRAY_LINE = "#E2E8F0"
TEXT    = "#1E293B"
LIGHT_TEXT = "#64748B"

hydro_cmap = LinearSegmentedColormap.from_list("hydro", ["#EFF6FF", BLUE])


def load_data_and_predict():
    data   = pd.read_csv(config.FEATURES_FILE)
    X      = data.drop("label", axis=1)
    y      = data["label"]
    scaler = joblib.load(config.MODELS_DIR / "scaler.pkl")
    model  = joblib.load(config.MODELS_DIR / "random_forest_model.pkl")

    X_scaled = scaler.transform(X)           # use already-fitted scaler
    _, X_test, _, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )

    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    # Feature importance (works for single ET/RF, not VotingClassifier)
    importances = None
    try:
        est = model
        if hasattr(est, "feature_importances_"):
            importances = pd.Series(est.feature_importances_, index=X.columns)
        elif hasattr(est, "estimators_"):          # VotingClassifier
            fi = np.mean([e.feature_importances_ for e in est.estimators_], axis=0)
            importances = pd.Series(fi, index=X.columns)
    except Exception:
        pass

    return y_test.values, y_pred, y_proba, importances, X.columns


def format_metric(val, pct=True):
    return f"{val * 100:.2f}%" if pct else f"{val:.4f}"


def draw_metric_box(ax, title, value, subtitle=None, color=BLUE):
    ax.set_facecolor(GRAY_BG)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.axis("off")
    ax.text(0.5, 0.62, value, ha="center", va="center",
            fontsize=28, fontweight="bold", color=color, transform=ax.transAxes)
    ax.text(0.5, 0.30, title, ha="center", va="center",
            fontsize=10, color=LIGHT_TEXT, transform=ax.transAxes)
    if subtitle:
        ax.text(0.5, 0.14, subtitle, ha="center", va="center",
                fontsize=8, color=LIGHT_TEXT, transform=ax.transAxes)
    for spine in ax.spines.values():
        spine.set_visible(True)
        spine.set_linewidth(1.5)
        spine.set_edgecolor(color)


def main():
    print("Loading model and recreating test split...")
    y_test, y_pred, y_proba, importances, feat_names = load_data_and_predict()

    acc  = accuracy_score(y_test, y_pred)
    f1w  = f1_score(y_test, y_pred, average="weighted")
    f1m  = f1_score(y_test, y_pred, average="macro")
    cm   = confusion_matrix(y_test, y_pred)
    fpr, tpr, _ = roc_curve(y_test, y_proba)
    roc_auc      = auc(fpr, tpr)
    prec, rec, _ = precision_recall_curve(y_test, y_proba)
    ap            = average_precision_score(y_test, y_proba)

    report = classification_report(y_test, y_pred,
                                   target_names=["Non-Leak", "Leak"],
                                   output_dict=True)

    # ── Layout ──────────────────────────────────────────────────────────────
    fig = plt.figure(figsize=(18, 14), facecolor="white")
    fig.patch.set_facecolor("white")

    # Title banner
    fig.text(0.5, 0.975, "HydroSense — Acoustic Leak Detection: Model Evaluation",
             ha="center", va="top", fontsize=17, fontweight="bold", color=TEXT)
    fig.text(0.5, 0.955,
             "ExtraTreesClassifier · 8 558 windows · 20 DSP features · Hydrophone + Accelerometer",
             ha="center", va="top", fontsize=10, color=LIGHT_TEXT)

    gs = gridspec.GridSpec(3, 4, figure=fig,
                           top=0.93, bottom=0.06,
                           left=0.06, right=0.97,
                           hspace=0.46, wspace=0.38)

    # ── Row 0: metric boxes ──────────────────────────────────────────────────
    ax_acc  = fig.add_subplot(gs[0, 0])
    ax_f1w  = fig.add_subplot(gs[0, 1])
    ax_roc  = fig.add_subplot(gs[0, 2])
    ax_ap   = fig.add_subplot(gs[0, 3])

    draw_metric_box(ax_acc, "Test Accuracy",  format_metric(acc),  color=BLUE)
    draw_metric_box(ax_f1w, "Weighted F1",    format_metric(f1w),  color=TEAL)
    draw_metric_box(ax_roc, "ROC-AUC",        format_metric(roc_auc), color=AMBER)
    draw_metric_box(ax_ap,  "Avg Precision",  format_metric(ap),   color=TEAL)

    # ── Row 1, col 0-1: Confusion matrix ────────────────────────────────────
    ax_cm = fig.add_subplot(gs[1, 0:2])
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)

    im = ax_cm.imshow(cm_norm, interpolation="nearest", cmap=hydro_cmap,
                      vmin=0, vmax=1)
    fig.colorbar(im, ax=ax_cm, fraction=0.046, pad=0.04).set_label(
        "Row-normalised rate", fontsize=8, color=LIGHT_TEXT)

    classes = ["Non-Leak", "Leak"]
    tick_marks = np.arange(len(classes))
    ax_cm.set_xticks(tick_marks); ax_cm.set_xticklabels(classes, fontsize=10)
    ax_cm.set_yticks(tick_marks); ax_cm.set_yticklabels(classes, fontsize=10, rotation=90, va="center")
    ax_cm.set_xlabel("Predicted label", fontsize=10, color=LIGHT_TEXT)
    ax_cm.set_ylabel("True label",      fontsize=10, color=LIGHT_TEXT)
    ax_cm.set_title("Confusion Matrix", fontsize=12, fontweight="bold", color=TEXT, pad=10)

    for i in range(2):
        for j in range(2):
            rate  = cm_norm[i, j]
            count = cm[i, j]
            color = "white" if rate > 0.55 else TEXT
            ax_cm.text(j, i, f"{count}\n({rate*100:.1f}%)",
                       ha="center", va="center", fontsize=12,
                       fontweight="bold", color=color)

    # ── Row 1, col 2-3: ROC curve ────────────────────────────────────────────
    ax_roc_curve = fig.add_subplot(gs[1, 2:4])
    ax_roc_curve.plot(fpr, tpr, color=BLUE, lw=2.5,
                      label=f"ExtraTrees (AUC = {roc_auc:.4f})")
    ax_roc_curve.plot([0, 1], [0, 1], color=GRAY_LINE, lw=1.5,
                      linestyle="--", label="Random classifier")
    ax_roc_curve.fill_between(fpr, tpr, alpha=0.08, color=BLUE)
    ax_roc_curve.set_xlim(-0.01, 1.01); ax_roc_curve.set_ylim(-0.01, 1.05)
    ax_roc_curve.set_xlabel("False Positive Rate", fontsize=10, color=LIGHT_TEXT)
    ax_roc_curve.set_ylabel("True Positive Rate",  fontsize=10, color=LIGHT_TEXT)
    ax_roc_curve.set_title("ROC Curve", fontsize=12, fontweight="bold", color=TEXT, pad=10)
    ax_roc_curve.legend(fontsize=9, framealpha=0.9)
    ax_roc_curve.set_facecolor(GRAY_BG)
    ax_roc_curve.grid(True, color=GRAY_LINE, linewidth=0.8)
    ax_roc_curve.tick_params(colors=LIGHT_TEXT)

    # ── Row 2, col 0-1: Precision-Recall curve ───────────────────────────────
    ax_pr = fig.add_subplot(gs[2, 0:2])
    ax_pr.plot(rec, prec, color=TEAL, lw=2.5,
               label=f"ExtraTrees (AP = {ap:.4f})")
    leak_prevalence = y_test.mean()
    ax_pr.axhline(y=leak_prevalence, color=AMBER, lw=1.5,
                  linestyle="--", label=f"Baseline (prevalence {leak_prevalence:.2f})")
    ax_pr.fill_between(rec, prec, alpha=0.08, color=TEAL)
    ax_pr.set_xlim(-0.01, 1.01); ax_pr.set_ylim(0.0, 1.05)
    ax_pr.set_xlabel("Recall",    fontsize=10, color=LIGHT_TEXT)
    ax_pr.set_ylabel("Precision", fontsize=10, color=LIGHT_TEXT)
    ax_pr.set_title("Precision-Recall Curve", fontsize=12, fontweight="bold", color=TEXT, pad=10)
    ax_pr.legend(fontsize=9, framealpha=0.9)
    ax_pr.set_facecolor(GRAY_BG)
    ax_pr.grid(True, color=GRAY_LINE, linewidth=0.8)
    ax_pr.tick_params(colors=LIGHT_TEXT)

    # ── Row 2, col 2-3: Feature importance ───────────────────────────────────
    ax_fi = fig.add_subplot(gs[2, 2:4])
    if importances is not None:
        top = importances.sort_values(ascending=False).head(10)
        colors_fi = [BLUE if i == 0 else (TEAL if i < 3 else GRAY_LINE)
                     for i in range(len(top))]
        bars = ax_fi.barh(top.index[::-1], top.values[::-1],
                          color=colors_fi[::-1], edgecolor="none", height=0.65)
        for bar, val in zip(bars, top.values[::-1]):
            ax_fi.text(val + 0.001, bar.get_y() + bar.get_height() / 2,
                       f"{val:.3f}", va="center", fontsize=8, color=LIGHT_TEXT)
        ax_fi.set_xlabel("Mean Impurity Decrease", fontsize=10, color=LIGHT_TEXT)
        ax_fi.set_title("Top 10 Feature Importances", fontsize=12,
                        fontweight="bold", color=TEXT, pad=10)
    else:
        ax_fi.text(0.5, 0.5, "Feature importances not available\n(VotingClassifier)",
                   ha="center", va="center", fontsize=11, color=LIGHT_TEXT,
                   transform=ax_fi.transAxes)
        ax_fi.set_title("Feature Importances", fontsize=12, fontweight="bold", color=TEXT)
    ax_fi.set_facecolor(GRAY_BG)
    ax_fi.grid(True, axis="x", color=GRAY_LINE, linewidth=0.8)
    ax_fi.tick_params(colors=LIGHT_TEXT)
    for spine in ax_fi.spines.values():
        spine.set_color(GRAY_LINE)

    # ── Footer ───────────────────────────────────────────────────────────────
    nl = report["Non-Leak"]; lk = report["Leak"]
    footer = (
        f"Non-Leak → Precision {nl['precision']:.2f}  Recall {nl['recall']:.2f}  "
        f"F1 {nl['f1-score']:.2f}  (n={int(nl['support'])})     |     "
        f"Leak → Precision {lk['precision']:.2f}  Recall {lk['recall']:.2f}  "
        f"F1 {lk['f1-score']:.2f}  (n={int(lk['support'])})     |     "
        f"Macro F1 {f1m:.4f}"
    )
    fig.text(0.5, 0.018, footer, ha="center", va="bottom",
             fontsize=9, color=LIGHT_TEXT,
             bbox=dict(boxstyle="round,pad=0.4", facecolor=GRAY_BG,
                       edgecolor=GRAY_LINE, linewidth=1))

    out_path = config.MODELS_DIR / "results_dashboard.png"
    fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
    print(f"Dashboard saved -> {out_path}")


if __name__ == "__main__":
    main()
