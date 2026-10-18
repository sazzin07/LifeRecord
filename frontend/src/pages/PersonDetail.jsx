import { useParams, useNavigate } from "react-router-dom";
import PersonDetailModal from "@/components/PersonDetailModal";

export default function PersonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <PersonDetailModal
      personId={id}
      open={true}
      onClose={() => nav("/people")}
      onEdit={() => nav("/people")}
      onDelete={() => nav("/people")}
    />
  );
}
