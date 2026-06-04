using UnityEngine;

public class CameraController : MonoBehaviour
{
    [Header("References")]
    public GameParameters gameParameters;
    public Transform target;

    [Header("Camera Settings")]
    public float distance = 10f;
    public float height = 15f;
    public float smoothSpeed = 5f;

    private Vector3 offset;

    void Start()
    {
        if (target == null)
        {
            target = GameObject.FindGameObjectWithTag("Player")?.transform;
        }

        if (gameParameters != null)
        {
            distance = gameParameters.cameraDistance;
            height = gameParameters.cameraHeight;
            smoothSpeed = gameParameters.cameraSmoothSpeed;
        }

        offset = new Vector3(0f, height, -distance);
    }

    void LateUpdate()
    {
        if (target == null) return;

        Vector3 desiredPosition = target.position + offset;
        Vector3 smoothedPosition = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed * Time.deltaTime);
        transform.position = smoothedPosition;

        Quaternion targetRotation = Quaternion.LookAt(target.position - transform.position, Vector3.up);
        transform.rotation = Quaternion.Slerp(transform.rotation, targetRotation, smoothSpeed * Time.deltaTime);
    }
}
