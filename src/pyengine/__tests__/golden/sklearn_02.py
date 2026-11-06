import numpy as np
from sklearn.metrics import (accuracy_score, precision_score, recall_score, f1_score, fbeta_score, confusion_matrix, classification_report,
    roc_curve, roc_auc_score, auc, precision_recall_curve, average_precision_score, log_loss, mean_squared_error, mean_absolute_error,
    r2_score, root_mean_squared_error, median_absolute_error, mean_absolute_percentage_error, balanced_accuracy_score,
    silhouette_score, adjusted_rand_score, normalized_mutual_info_score, cohen_kappa_score, matthews_corrcoef, get_scorer)
from sklearn.metrics.pairwise import cosine_similarity, euclidean_distances

y_true = np.array([0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1])
y_pred = np.array([0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1])
print(accuracy_score(y_true, y_pred), precision_score(y_true, y_pred), recall_score(y_true, y_pred), f1_score(y_true, y_pred))
print(fbeta_score(y_true, y_pred, beta=2), balanced_accuracy_score(y_true, y_pred))
print(confusion_matrix(y_true, y_pred))
print(confusion_matrix(y_true, y_pred, normalize="true").round(3))
print(classification_report(y_true, y_pred))
print(classification_report(y_true, y_pred, target_names=["no", "si"], digits=3))
print(cohen_kappa_score(y_true, y_pred), round(matthews_corrcoef(y_true, y_pred), 6))

scores = np.array([0.1, 0.9, 0.35, 0.2, 0.8, 0.65, 0.55, 0.3, 0.7, 0.05, 0.4, 0.95])
fpr, tpr, th = roc_curve(y_true, scores)
print(fpr.round(3), tpr.round(3), th)
print(round(roc_auc_score(y_true, scores), 6), round(auc(fpr, tpr), 6))
p, r, t = precision_recall_curve(y_true, scores)
print(p.round(3), r.round(3), t)
print(round(average_precision_score(y_true, scores), 6))
print(round(log_loss(y_true, scores), 6))

ym = np.array([0, 1, 2, 2, 1, 0, 2, 1, 0, 2])
pm = np.array([0, 2, 2, 2, 1, 0, 1, 1, 0, 1])
print(classification_report(ym, pm))
print(f1_score(ym, pm, average="macro"), f1_score(ym, pm, average="micro"), f1_score(ym, pm, average="weighted"))
print(precision_score(ym, pm, average=None).round(4), recall_score(ym, pm, average=None).round(4))
print(confusion_matrix(ym, pm))
probs = np.array([[0.8, 0.1, 0.1], [0.2, 0.3, 0.5], [0.1, 0.2, 0.7], [0.1, 0.1, 0.8], [0.2, 0.6, 0.2], [0.7, 0.2, 0.1], [0.3, 0.4, 0.3], [0.1, 0.8, 0.1], [0.9, 0.05, 0.05], [0.2, 0.5, 0.3]])
print(round(roc_auc_score(ym, probs, multi_class="ovr"), 6))
print(round(log_loss(ym, probs), 6))

a = np.array([3.0, -0.5, 2.0, 7.0, 4.2])
b = np.array([2.5, 0.0, 2.1, 7.8, 3.9])
print(mean_squared_error(a, b), root_mean_squared_error(a, b), mean_absolute_error(a, b), r2_score(a, b))
print(median_absolute_error(a, b), mean_absolute_percentage_error(a, b))
print(r2_score([1, 2, 3], [1, 2, 3]), r2_score([3, 3, 3], [3, 3, 3]))
print(cosine_similarity(np.array([[1.0, 0.0], [1.0, 1.0]]), np.array([[0.0, 1.0]])).round(4))
print(euclidean_distances(np.array([[0.0, 0.0], [3.0, 4.0]])))
X = np.array([[0.0, 0.0], [0.1, 0.2], [5.0, 5.0], [5.2, 4.9], [0.2, 0.1], [4.9, 5.1]])
lab = np.array([0, 0, 1, 1, 0, 1])
print(round(silhouette_score(X, lab), 6), adjusted_rand_score(lab, [1, 1, 0, 0, 1, 0]), round(normalized_mutual_info_score(lab, [0, 0, 1, 1, 1, 1]), 6))
print(get_scorer("neg_mean_squared_error")._sign if hasattr(get_scorer("neg_mean_squared_error"), "_sign") else -1)
