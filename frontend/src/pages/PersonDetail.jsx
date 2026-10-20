import { useParams, useNavigate } from "react-router-dom";
import PersonDetailModal from "@/components/PersonDetailModal";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { toast } from "sonner";

export default function PersonDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  const handleEdit = (person) => {
    if (!person) return;
    nav("/people", { state: { editPerson: person } });
  };

  const handleDelete = async (personId) => {
    try {
      await api.delete(`/people/${personId}`);
      toast.success("Person deleted");
      refreshAll();
      nav("/people");
    } catch {
      toast.error("Could not delete person");
    }
  };

  return (
    <PersonDetailModal
      personId={id}
      open={true}
      onClose={() => nav("/people")}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
}
